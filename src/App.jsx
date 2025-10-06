import { useEffect, useRef, useState } from "react";

export default function App() {
  const canvasRef = useRef(null);

  // Game state
  const [mode, setMode] = useState(null);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [gameOver, setGameOver] = useState(false);
  const [level, setLevel] = useState(1);
  const [levelTarget, setLevelTarget] = useState(200);
  const [leaderboard, setLeaderboard] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("si_leaderboard_v1") || "[]");
    } catch {
      return [];
    }
  });

  const countdownStartTime = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const WIDTH = 640;
    const HEIGHT = 368;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    const ship = { x: 40, y: HEIGHT / 2 - 16, w: 32, h: 32, speed: 4 };
    let bullets = [];
    let enemies = [];
    let enemyBullets = [];
    let powerups = [];
    let explosions = [];
    const stars = Array.from({ length: 120 }, () => ({
      x: Math.random() * WIDTH,
      y: Math.random() * HEIGHT,
      size: Math.random() * 2 + 1,
      speed: Math.random() * 1.5 + 0.5,
    }));

    let keys = {};
    let enemyTimer = 0;
    let powerupTimer = 0;
    let bulletTimer = 0;
    let spawnAllowed = true;
    let boss = null;
    let doubleShot = false;
    let doubleTimer = 0;

    let animationId = null;

    function clamp(v, a, b) {
      return Math.max(a, Math.min(b, v));
    }

    // --- Input ---
    const handleKeyDown = (e) => {
      keys[e.key] = true;

      if (!mode && (e.key === "1" || e.key === "2")) {
        setMode(e.key === "1" ? "level" : "endless");
        countdownStartTime.current = Date.now();
      }

      if (e.key === "r" || e.key === "R") restartGame();
      if (e.key === "m" || e.key === "M") goToMenu();
    };
    const handleKeyUp = (e) => (keys[e.key] = false);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // --- Difficulty ---
    function getDifficultyMultiplier() {
      return mode === "level" ? Math.max(0, level - 1) * 0.4 : Math.floor(score / 200) * 0.25;
    }

    // --- Score / Boss ---
    function addScore(points) {
      setScore((s) => {
        const newS = s + points;
        if (mode === "level" && !boss && newS >= levelTarget) spawnBossForLevel(level);
        return newS;
      });
    }

    function spawnBossForLevel(lvl) {
      boss = {
        type: "boss",
        x: WIDTH,
        y: HEIGHT / 2 - 64,
        w: 128,
        h: 128,
        speed: 1,
        hp: 25 + (lvl - 1) * 10,
        phaseTimer: 0,
        shootTimer: 0,
      };
      spawnAllowed = false;
    }

    function handleBossDefeat() {
      addScore(100);
      boss = null;
      spawnAllowed = true;
      if (mode === "level") {
        setLevel((lvl) => {
          const next = lvl + 1;
          setLevelTarget(next * 200);
          return next;
        });
      }
    }

    // --- Restart / Menu ---
    function restartGame() {
      bullets = [];
      enemies = [];
      enemyBullets = [];
      powerups = [];
      explosions = [];
      boss = null;
      doubleShot = false;
      doubleTimer = 0;
      enemyTimer = 0;
      powerupTimer = 0;
      bulletTimer = 0;
      spawnAllowed = true;
      setScore(0);
      setLives(3);
      setGameOver(false);
      setLevel(1);
      setLevelTarget(200);
      ship.x = 40;
      ship.y = HEIGHT / 2 - ship.h / 2;
      countdownStartTime.current = Date.now();
    }

    function goToMenu() {
      restartGame();
      setMode(null);
      setGameOver(false);
    }

    function persistLeaderboardIfNeeded() {
      if (mode === "endless") {
        const existing = JSON.parse(localStorage.getItem("si_leaderboard_v1") || "[]");
        existing.push(score);
        existing.sort((a, b) => b - a);
        const top = existing.slice(0, 10);
        localStorage.setItem("si_leaderboard_v1", JSON.stringify(top));
        setLeaderboard(top);
      }
    }

    // --- Spawn Enemies / Powerups ---
    function spawnEnemy() {
      const t = Math.random();
      if (t < 0.55)
        enemies.push({
          type: "normal",
          x: WIDTH,
          y: Math.random() * (HEIGHT - 28),
          w: 28,
          h: 28,
          speed: 2 + getDifficultyMultiplier(),
          hp: 1,
        });
      else if (t < 0.78)
        enemies.push({
          type: "fast",
          x: WIDTH,
          y: Math.random() * (HEIGHT - 20),
          w: 20,
          h: 20,
          speed: 3.5 + getDifficultyMultiplier() * 1.2,
          hp: 1,
        });
      else if (t < 0.95)
        enemies.push({
          type: "zigzag",
          x: WIDTH,
          y: Math.random() * (HEIGHT - 24),
          w: 24,
          h: 24,
          speed: 2 + getDifficultyMultiplier(),
          hp: 2,
          angle: Math.random() * Math.PI * 2,
        });
      else
        enemies.push({
          type: "miniboss",
          x: WIDTH,
          y: Math.random() * (HEIGHT - 44),
          w: 44,
          h: 44,
          speed: 1.2 + getDifficultyMultiplier() * 0.3,
          hp: 6 + Math.floor(getDifficultyMultiplier() * 2),
        });
    }

    function spawnPowerup() {
      const kind = Math.random() < 0.5 ? "life" : "double";
      powerups.push({ type: kind, x: WIDTH, y: Math.random() * (HEIGHT - 20), w: 20, h: 20, speed: 2 });
    }

    // --- Collision Helpers ---
    function rectsCollide(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    function updateGameObjects() {
      // --- Bullets ---
      bullets.forEach((b, i) => {
        b.x += b.speed;
        if (b.x > WIDTH) bullets.splice(i, 1);

        // Hit enemies
        enemies.forEach((e, j) => {
          if (rectsCollide(b, e)) {
            e.hp--;
            bullets.splice(i, 1);
            if (e.hp <= 0) {
              explosions.push({ ...e, timer: 20 });
              enemies.splice(j, 1);
              addScore(e.type === "miniboss" ? 15 : 5);
            }
          }
        });

        // Hit boss
        if (boss && rectsCollide(b, boss)) {
          boss.hp--;
          bullets.splice(i, 1);
          if (boss.hp <= 0) handleBossDefeat();
        }
      });

      // --- Enemies ---
      enemies.forEach((e, i) => {
        e.x -= e.speed;
        if (e.type === "zigzag") e.y += Math.sin(Date.now() / 200 + e.angle) * 2;
        if (e.x + e.w < 0) enemies.splice(i, 1);

        // Collide with player
        if (rectsCollide(e, ship)) {
          enemies.splice(i, 1);
          loseLife();
        }
      });

      // --- Powerups ---
      powerups.forEach((p, i) => {
        p.x -= p.speed;
        if (rectsCollide(p, ship)) {
          if (p.type === "life") setLives((l) => l + 1);
          else if (p.type === "double") {
            doubleShot = true;
            doubleTimer = 600; // lasts ~10s
          }
          powerups.splice(i, 1);
        }
        if (p.x + p.w < 0) powerups.splice(i, 1);
      });

      // --- Boss movement ---
      if (boss) {
        boss.x -= boss.speed;
        if (boss.x < WIDTH - boss.w - 100) boss.x = WIDTH - boss.w - 100;
      }

      // --- Double shot timer ---
      if (doubleShot) {
        doubleTimer--;
        if (doubleTimer <= 0) doubleShot = false;
      }
    }

    function loseLife() {
      setLives((l) => {
        const remaining = l - 1;
        if (remaining <= 0) {
          setGameOver(true);
          persistLeaderboardIfNeeded();
        }
        return remaining;
      });
    }

    // --- Game Loop ---
    function gameLoop() {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      // Stars
      ctx.fillStyle = "#fff";
      stars.forEach((s) => {
        ctx.fillRect(s.x, s.y, s.size, s.size);
        s.x -= s.speed;
        if (s.x < 0) {
          s.x = WIDTH;
          s.y = Math.random() * HEIGHT;
        }
      });

      // Menu
      if (!mode) {
        ctx.fillStyle = "#0f0";
        ctx.font = "20px monospace";
        ctx.fillText("SPACE IMPACT - Retro Clone", WIDTH / 2 - 150, HEIGHT / 2 - 60);
        ctx.fillStyle = "#fff";
        ctx.fillText("Press 1 → Level Mode", WIDTH / 2 - 180, HEIGHT / 2 - 20);
        ctx.fillText("Press 2 → Endless Mode", WIDTH / 2 - 180, HEIGHT / 2 + 10);
        const blink = Math.floor(Date.now() / 500) % 2 === 0;
        if (blink) ctx.fillStyle = "#ff0", ctx.fillText("PRESS START", WIDTH / 2 - 70, HEIGHT / 2 + 60);
        animationId = requestAnimationFrame(gameLoop);
        return;
      }

      // Countdown
      if (countdownStartTime.current) {
        const elapsed = Math.floor((Date.now() - countdownStartTime.current) / 1000);
        const remaining = 3 - elapsed;
        ctx.fillStyle = "#ff0";
        ctx.font = "60px monospace";
        ctx.fillText(remaining > 0 ? remaining : "GO!", WIDTH / 2 - 20, HEIGHT / 2);
        if (remaining <= 0) countdownStartTime.current = null;
        animationId = requestAnimationFrame(gameLoop);
        return;
      }

      // Game over
      if (gameOver) {
        ctx.fillStyle = "#fff";
        ctx.font = "22px monospace";
        ctx.fillText("GAME OVER", WIDTH / 2 - 70, HEIGHT / 2 - 10);
        ctx.font = "16px monospace";
        ctx.fillText("Press R to Restart", WIDTH / 2 - 80, HEIGHT / 2 + 20);
        ctx.fillText("Press M for Menu", WIDTH / 2 - 70, HEIGHT / 2 + 44);
        if (mode === "endless") {
          ctx.fillStyle = "#ff0";
          ctx.fillText("Top Scores:", WIDTH / 2 - 60, HEIGHT / 2 + 80);
          ctx.fillStyle = "#fff";
          leaderboard.forEach((v, idx) => ctx.fillText(`${idx + 1}. ${v}`, WIDTH / 2 - 40, HEIGHT / 2 + 110 + idx * 20));
        }
        animationId = requestAnimationFrame(gameLoop);
        return;
      }

      // HUD
      ctx.fillStyle = "#0f0";
      ctx.font = "16px monospace";
      ctx.fillText(`Score: ${score}`, 12, 20);
      ctx.fillText(`Lives: ${lives}`, 12, 40);
      ctx.fillText(`Mode: ${mode === "level" ? `Level ${level}` : "Endless"}`, 12, 60);
      if (mode === "level") ctx.fillText(`Target: ${levelTarget}`, 12, 80);

      // Player
      ctx.fillStyle = "#0ff";
      ctx.fillRect(ship.x, ship.y, ship.w, ship.h);
      if (keys["ArrowUp"]) ship.y = clamp(ship.y - ship.speed, 0, HEIGHT - ship.h);
      if (keys["ArrowDown"]) ship.y = clamp(ship.y + ship.speed, 0, HEIGHT - ship.h);
      if (keys["ArrowLeft"]) ship.x = clamp(ship.x - ship.speed, 0, WIDTH / 2 - ship.w);
      if (keys["ArrowRight"]) ship.x = clamp(ship.x + ship.speed, 0, WIDTH / 2 - ship.w);

      // Auto-fire
      bulletTimer++;
      const fireInterval = doubleShot ? 12 : 20;
      if (bulletTimer > fireInterval) {
        if (doubleShot) {
          bullets.push({ x: ship.x + ship.w, y: ship.y + 6, w: 8, h: 6, speed: 6 });
          bullets.push({ x: ship.x + ship.w, y: ship.y + ship.h - 12, w: 8, h: 6, speed: 6 });
        } else bullets.push({ x: ship.x + ship.w, y: ship.y + ship.h / 2 - 3, w: 8, h: 6, speed: 6 });
        bulletTimer = 0;
      }

      // Spawn enemies / powerups
      enemyTimer++;
      if (enemyTimer > 60 && spawnAllowed) {
        spawnEnemy();
        enemyTimer = 0;
      }
      powerupTimer++;
      if (powerupTimer > 500) {
        spawnPowerup();
        powerupTimer = 0;
      }

      // Update bullets, enemies, collisions, boss
      updateGameObjects();

      // Draw enemies
      ctx.fillStyle = "#f00";
      enemies.forEach((e) => ctx.fillRect(e.x, e.y, e.w, e.h));
      if (boss) {
        ctx.fillStyle = "#800";
        ctx.fillRect(boss.x, boss.y, boss.w, boss.h);
      }

      // Draw bullets
      ctx.fillStyle = "#ff0";
      bullets.forEach((b) => ctx.fillRect(b.x, b.y, b.w, b.h));

      // Draw powerups
      powerups.forEach((p) => {
        ctx.fillStyle = p.type === "life" ? "#0f0" : "#0ff";
        ctx.fillRect(p.x, p.y, p.w, p.h);
      });

      // Draw explosions
      explosions.forEach((ex, i) => {
        ctx.fillStyle = "#fff";
        ctx.fillRect(ex.x, ex.y, ex.w, ex.h);
        ex.timer--;
        if (ex.timer <= 0) explosions.splice(i, 1);
      });

      animationId = requestAnimationFrame(gameLoop);
    }

    animationId = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [mode, score, lives, level, levelTarget, gameOver]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-4">
      <h1 className="text-2xl font-mono mb-1">Space Impact — Retro Clone</h1>
      <div className="text-sm font-mono mb-3">Arrow keys = move, R = Restart, M = Menu</div>
      <canvas ref={canvasRef} className="border-4 border-green-500" style={{ imageRendering: "pixelated" }} />
    </div>
  );
}

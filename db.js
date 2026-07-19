const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
require("dotenv").config();

let pool;

async function initializeDatabase() {
  pool = mysql.createPool({
    host: process.env.DB_HOST,

    user: process.env.DB_USER,

    password: process.env.DB_PASSWORD,

    database: process.env.DB_NAME,

    port: Number(process.env.DB_PORT) || 3306,

    waitForConnections: true,

    connectionLimit: 10,

    charset: "utf8mb4",
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      isim VARCHAR(32) NOT NULL UNIQUE,
      sifre VARCHAR(255) NOT NULL,
      puan INT NOT NULL DEFAULT 0,
      taskPoints INT NOT NULL DEFAULT 0,
      correct INT NOT NULL DEFAULT 0,
      wrong INT NOT NULL DEFAULT 0,
      totalQuestions INT NOT NULL DEFAULT 0,
      claimedRoadRewards TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await upgradePlaintextPasswords();

  return pool;
}

async function createUser({ isim, sifre }) {
  const hashedPassword = hashPassword(sifre);

  await pool.execute(
    `
    INSERT INTO users 
    (isim, sifre, claimedRoadRewards)
    VALUES (?, ?, ?)
    `,
    [isim, hashedPassword, ""],
  );

  return {
    isim,
    sifre: hashedPassword,
  };
}

async function findUser(isim) {
  const [rows] = await pool.execute("SELECT * FROM users WHERE isim = ?", [
    isim,
  ]);

  return rows[0] || null;
}

function hashPassword(password) {
  return bcrypt.hashSync(String(password), 10);
}

function isPasswordHash(value) {
  return typeof value === "string" && /^\$2[aby]?\$\d{2}\$/.test(value);
}

function verifyPassword(password, storedPassword) {
  if (!storedPassword) return false;

  if (isPasswordHash(storedPassword)) {
    return bcrypt.compareSync(String(password), storedPassword);
  }

  return String(password) === String(storedPassword);
}

async function upgradePasswordHashIfNeeded(
  isim,
  storedPassword,
  plainPassword,
) {
  if (isPasswordHash(storedPassword)) return;

  if (!verifyPassword(plainPassword, storedPassword)) return;

  await pool.execute(
    `
    UPDATE users 
    SET sifre = ?
    WHERE isim = ?
    `,
    [hashPassword(plainPassword), isim],
  );
}

async function upgradePlaintextPasswords() {
  const [rows] = await pool.query("SELECT id, sifre FROM users");

  for (const user of rows) {
    if (!isPasswordHash(user.sifre)) {
      await pool.execute(
        `
        UPDATE users 
        SET sifre = ?
        WHERE id = ?
        `,
        [hashPassword(user.sifre), user.id],
      );
    }
  }
}

async function updateUserScore(
  isim,
  { score = 0, taskPoints = 0, correct = 0, wrong = 0, totalQuestions = 0 },
) {
  await pool.execute(
    `
    UPDATE users SET

    puan = puan + ?,
    taskPoints = taskPoints + ?,
    correct = correct + ?,
    wrong = wrong + ?,
    totalQuestions = totalQuestions + ?

    WHERE isim = ?

    `,
    [score, taskPoints, correct, wrong, totalQuestions, isim],
  );
}

function parseClaimedRoadRewards(value) {
  if (!value) return [];

  return String(value).split("|").filter(Boolean);
}

function serializeClaimedRoadRewards(value) {
  return Array.isArray(value) ? value.join("|") : "";
}

async function addClaimedRoadReward(isim, milestoneId) {
  const user = await findUser(isim);

  if (!user) return false;

  const rewards = new Set(parseClaimedRoadRewards(user.claimedRoadRewards));

  rewards.add(milestoneId);

  await pool.execute(
    `
    UPDATE users
    SET claimedRoadRewards = ?
    WHERE isim = ?
    `,
    [serializeClaimedRoadRewards([...rewards]), isim],
  );

  return true;
}

function getScoreTitle(score) {
  const titles = [
    { min: 0, max: 99, title: "Acemi Kaptan" },

    { min: 100, max: 249, title: "Dalga Öğrencisi" },

    { min: 250, max: 499, title: "Kelime Çırağı" },

    { min: 500, max: 799, title: "Söz Avcısı" },

    { min: 800, max: 1199, title: "Mavi Ufuk Yolcusu" },

    { min: 1200, max: 1599, title: "Deniz Rehberi" },

    { min: 1600, max: 2199, title: "Bilge Denizci" },

    { min: 2200, max: 2999, title: "Lügat Ustası" },

    { min: 3000, max: 4499, title: "Okyanus Kahramanı" },

    { min: 4500, max: Infinity, title: "Kelime Okyanusu Efsanesi" },
  ];

  const found = titles.find((x) => score >= x.min && score <= x.max);

  return found ? found.title : "Acemi Kaptan";
}
async function getUsersWithRanks() {
  const [rows] = await pool.query(
    `
    SELECT *
    FROM users
    ORDER BY puan DESC,id ASC
    `,
  );

  return rows.map((user, index) => ({
    isim: user.isim,
    puan: Number(user.puan),
    taskPoints: Number(user.taskPoints),
    correct: Number(user.correct),
    wrong: Number(user.wrong),
    totalQuestions: Number(user.totalQuestions),
    title: getScoreTitle(Number(user.puan) || 0),

    ...getProgressSnapshot(
      Number(user.puan) || 0,

      parseClaimedRoadRewards(user.claimedRoadRewards),

      Number(user.taskPoints) || 0,
    ),
    rank: index + 1,

    claimedRoadRewards: parseClaimedRoadRewards(user.claimedRoadRewards),
  }));
}

async function getUserSnapshot(isim) {
  const user = await findUser(isim);

  if (!user) return null;

  return {
    isim: user.isim,

    puan: Number(user.puan) || 0,

    taskPoints: Number(user.taskPoints) || 0,

    correct: Number(user.correct) || 0,

    wrong: Number(user.wrong) || 0,

    totalQuestions: Number(user.totalQuestions) || 0,

    claimedRoadRewards: parseClaimedRoadRewards(user.claimedRoadRewards),

    title: getScoreTitle(Number(user.puan) || 0),

    ...getProgressSnapshot(
      Number(user.puan) || 0,

      parseClaimedRoadRewards(user.claimedRoadRewards),

      Number(user.taskPoints) || 0,
    ),
  };
}
function getRoadRotationIndex(taskPoints) {
  const size = 1000;

  return Math.max(1, Math.floor(taskPoints / size) + 1);
}

function getRoadRotationBase(index) {
  return (index - 1) * 1000;
}

function getProgressSnapshot(score, claimedRoadRewards = [], taskPoints = 0) {
  const ROAD_TEMPLATE = [
    {
      id: "seed",
      offset: 100,
      title: "Baloncuk Adımı",
      reward: "Görev puanı +10",
    },

    {
      id: "sprout",
      offset: 250,
      title: "Dalga Adımı",
      reward: "Görev puanı +15",
    },

    {
      id: "wave",
      offset: 450,
      title: "Yelken Adımı",
      reward: "Görev puanı +20",
    },

    {
      id: "sailor",
      offset: 650,
      title: "Ufuk Adımı",
      reward: "Görev puanı +25",
    },

    {
      id: "navigator",
      offset: 800,
      title: "Mavi Deniz Adımı",
      reward: "Görev puanı +30",
    },

    {
      id: "legend",
      offset: 940,
      title: "Efsane Adımı",
      reward: "Görev puanı +35",
    },
  ];

  const active = Number(taskPoints) || 0;

  const rotationIndex = getRoadRotationIndex(active);

  const base = getRoadRotationBase(rotationIndex);

  const claimed = new Set(
    Array.isArray(claimedRoadRewards) ? claimedRoadRewards : [],
  );

  const milestones = ROAD_TEMPLATE.map((item) => {
    const id = `r${rotationIndex}:${item.id}`;

    return {
      id,

      baseId: item.id,

      rotationIndex,

      score: base + item.offset,

      title: item.title,

      reward: item.reward,

      badge: item.title,

      unlocked: active >= base + item.offset,

      claimed: claimed.has(id),
    };
  });

  const progressValue = Math.max(0, active - base);

  return {
    currentTitle: getScoreTitle(score),

    rotationIndex,

    rotationLabel: `Adım ${rotationIndex}`,

    nextRotationStart: base + 1000,

    nextMilestone: milestones.find((m) => m.score > active) || null,

    roadProgressPercent: Math.min(
      100,
      Math.round((progressValue / 1000) * 100),
    ),

    roadProgressValue: progressValue,

    roadProgressTotal: 1000,

    currentMilestones: milestones,

    claimedRoadRewards: [...claimed],
  };
}
module.exports = {
  initializeDatabase,

  createUser,

  findUser,

  updateUserScore,

  getUsersWithRanks,

  getUserSnapshot,

  addClaimedRoadReward,

  hashPassword,

  verifyPassword,

  upgradePasswordHashIfNeeded,
  getScoreTitle,
  getProgressSnapshot,
};

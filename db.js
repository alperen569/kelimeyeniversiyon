const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = path.join(__dirname, 'database.sqlite');

function initializeDatabase(dbPath = DEFAULT_DB_PATH, options = {}) {
  const resolvedDbPath = path.resolve(dbPath);
  const shouldMigrateLegacy = options.migrateLegacy ?? resolvedDbPath === path.resolve(DEFAULT_DB_PATH);
  if (!fs.existsSync(path.dirname(resolvedDbPath))) {
    fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
  }

  const db = new DatabaseSync(resolvedDbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isim TEXT NOT NULL UNIQUE,
      sifre TEXT NOT NULL,
      puan INTEGER NOT NULL DEFAULT 0,
      taskPoints INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0,
      wrong INTEGER NOT NULL DEFAULT 0,
      totalQuestions INTEGER NOT NULL DEFAULT 0,
      claimedRoadRewards TEXT NOT NULL DEFAULT ''
    );
  `);
  ensureTaskPointsColumn(db);

  if (shouldMigrateLegacy) {
    migrateLegacyUsers(db);
  }

  return db;
}

function ensureTaskPointsColumn(db) {
  const columns = db.prepare('PRAGMA table_info(users)').all() || [];
  const hasTaskPoints = columns.some(column => column.name === 'taskPoints');
  if (!hasTaskPoints) {
    db.exec('ALTER TABLE users ADD COLUMN taskPoints INTEGER NOT NULL DEFAULT 0');
  }
}

function migrateLegacyUsers(db) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if ((row?.count || 0) > 0) {
    return;
  }

  const legacyPath = path.join(__dirname, 'users.txt');
  const resolvedDbPath = path.resolve(db.name || DEFAULT_DB_PATH);
  if (resolvedDbPath !== path.resolve(DEFAULT_DB_PATH)) {
    return;
  }
  if (!fs.existsSync(legacyPath)) {
    return;
  }

  const lines = fs.readFileSync(legacyPath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

const insertStmt = db.prepare('INSERT INTO users (isim, sifre, puan, taskPoints, correct, wrong, totalQuestions, claimedRoadRewards) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

  for (const line of lines) {
    const parts = line.split(':');
    if (parts.length < 3) {
      continue;
    }

    const isim = parts[0] || '';
    const sifre = parts[1] || '';
    const puan = Number(parts[2]) || 0;
    const correct = Number(parts[3]) || 0;
    const wrong = Number(parts[4]) || 0;
    const totalQuestions = Number(parts[5]) || 0;
    const claimedRoadRewards = parts[7] ? parseClaimedRoadRewards(parts[7]) : [];

    insertStmt.run(isim, sifre, puan, 0, correct, wrong, totalQuestions, serializeClaimedRoadRewards(claimedRoadRewards));
  }
}

function parseClaimedRoadRewards(value) {
  if (!value) return [];
  return String(value)
    .split('|')
    .map(v => v.trim())
    .filter(Boolean);
}

function serializeClaimedRoadRewards(value) {
  return Array.isArray(value) ? value.join('|') : '';
}

function getScoreTitle(score) {
  const SCORE_TITLES = [
    { min: 0, max: 99, title: 'Acemi Kaptan' },
    { min: 100, max: 249, title: 'Dalga Öğrencisi' },
    { min: 250, max: 499, title: 'Kelime Çırağı' },
    { min: 500, max: 799, title: 'Söz Avcısı' },
    { min: 800, max: 1199, title: 'Mavi Ufuk Yolcusu' },
    { min: 1200, max: 1599, title: 'Deniz Rehberi' },
    { min: 1600, max: 2199, title: 'Bilge Denizci' },
    { min: 2200, max: 2999, title: 'Lügat Ustası' },
    { min: 3000, max: 4499, title: 'Okyanus Kahramanı' },
    { min: 4500, max: Infinity, title: 'Kelime Okyanusu Efsanesi' }
  ];
  const found = SCORE_TITLES.find(item => score >= item.min && score <= item.max);
  return found ? found.title : 'Acemi Kaptan';
}

function getRoadRotationIndex(score) {
  const ROAD_ROTATION_SIZE = 1000;
  return Math.max(1, Math.floor(score / ROAD_ROTATION_SIZE) + 1);
}

function getRoadRotationBase(rotationIndex) {
  const ROAD_ROTATION_SIZE = 1000;
  return (rotationIndex - 1) * ROAD_ROTATION_SIZE;
}

function getProgressSnapshot(score, claimedRoadRewards = [], taskPoints = 0) {
  const ROAD_ROTATION_SIZE = 1000;
  const ROAD_TEMPLATE = [
    { id: 'seed', offset: 100, title: 'Baloncuk Adımı', reward: 'Görev puanı +10' },
    { id: 'sprout', offset: 250, title: 'Dalga Adımı', reward: 'Görev puanı +15' },
    { id: 'wave', offset: 450, title: 'Yelken Adımı', reward: 'Görev puanı +20' },
    { id: 'sailor', offset: 650, title: 'Ufuk Adımı', reward: 'Görev puanı +25' },
    { id: 'navigator', offset: 800, title: 'Mavi Deniz Adımı', reward: 'Görev puanı +30' },
    { id: 'legend', offset: 940, title: 'Efsane Adımı', reward: 'Görev puanı +35' }
  ];
  const activeTaskPoints = Number(taskPoints) || 0;
  const rotationIndex = getRoadRotationIndex(activeTaskPoints);
  const rotationBase = getRoadRotationBase(rotationIndex);
  const claimedSet = new Set(Array.isArray(claimedRoadRewards) ? claimedRoadRewards : []);
  const currentMilestones = ROAD_TEMPLATE.map(template => {
    const milestoneScore = rotationBase + template.offset;
    const milestoneKey = `r${rotationIndex}:${template.id}`;
    return {
      id: milestoneKey,
      baseId: template.id,
      rotationIndex,
      score: milestoneScore,
      title: template.title,
      reward: template.reward,
      badge: template.title,
      unlocked: activeTaskPoints >= milestoneScore,
      claimed: claimedSet.has(milestoneKey)
    };
  });
  const nextRotationStart = rotationBase + ROAD_ROTATION_SIZE;
  const progressValue = Math.max(0, activeTaskPoints - rotationBase);
  const progressTotal = ROAD_ROTATION_SIZE;
  const nextMilestone = currentMilestones.find(milestone => milestone.score > activeTaskPoints) || null;
  return {
    currentTitle: getScoreTitle(score),
    rotationIndex,
    rotationLabel: `Adım ${rotationIndex}`,
    nextRotationStart,
    nextMilestone,
    roadProgressPercent: Math.min(100, Math.round((progressValue / progressTotal) * 100)),
    roadProgressValue: progressValue,
    roadProgressTotal: progressTotal,
    currentMilestones,
    claimedRoadRewards: Array.isArray(claimedRoadRewards) ? claimedRoadRewards : []
  };
}

function createUser(db, { isim, sifre }) {
  const stmt = db.prepare('INSERT INTO users (isim, sifre) VALUES (?, ?)');
  stmt.run(isim, sifre);
  return { isim, sifre };
}

function findUser(db, isim) {
  const row = db.prepare('SELECT * FROM users WHERE isim = ?').get(isim);
  return row || null;
}

function getUsersWithRanks(db) {
  const rows = db.prepare('SELECT * FROM users ORDER BY puan DESC, id ASC').all();
  return rows.map((user, index) => {
    const claimedRoadRewards = parseClaimedRoadRewards(user.claimedRoadRewards);
    const totalQuestions = Number(user.totalQuestions) || 0;
    const correct = Number(user.correct) || 0;
    const successRate = totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;
    return {
      isim: user.isim,
      sifre: user.sifre,
      puan: Number(user.puan) || 0,
      taskPoints: Number(user.taskPoints) || 0,
      correct,
      wrong: Number(user.wrong) || 0,
      totalQuestions,
      successRate,
      rank: index + 1,
      claimedRoadRewards,
      title: getScoreTitle(Number(user.puan) || 0),
      ...getProgressSnapshot(Number(user.puan) || 0, claimedRoadRewards, Number(user.taskPoints) || 0)
    };
  });
}

function updateUserScore(db, isim, { score = 0, taskPoints = 0, correct = 0, wrong = 0, totalQuestions = 0 }) {
  const stmt = db.prepare(`
    UPDATE users
    SET puan = puan + ?, taskPoints = taskPoints + ?, correct = correct + ?, wrong = wrong + ?, totalQuestions = totalQuestions + ?
    WHERE isim = ?
  `);
  stmt.run(score, taskPoints, correct, wrong, totalQuestions, isim);
}

function addClaimedRoadReward(db, isim, milestoneId) {
  const user = findUser(db, isim);
  if (!user) return false;
  const claimed = new Set(parseClaimedRoadRewards(user.claimedRoadRewards));
  claimed.add(milestoneId);
  db.prepare('UPDATE users SET claimedRoadRewards = ? WHERE isim = ?').run(serializeClaimedRoadRewards(Array.from(claimed)), isim);
  return true;
}

function getUserSnapshot(db, isim) {
  const user = findUser(db, isim);
  if (!user) return null;
  const claimedRoadRewards = parseClaimedRoadRewards(user.claimedRoadRewards);
  const totalQuestions = Number(user.totalQuestions) || 0;
  const correct = Number(user.correct) || 0;
  const successRate = totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;
  return {
    isim: user.isim,
    puan: Number(user.puan) || 0,
    taskPoints: Number(user.taskPoints) || 0,
    correct,
    wrong: Number(user.wrong) || 0,
    totalQuestions,
    successRate,
    claimedRoadRewards,
    title: getScoreTitle(Number(user.puan) || 0),
    ...getProgressSnapshot(Number(user.puan) || 0, claimedRoadRewards, Number(user.taskPoints) || 0)
  };
}

module.exports = {
  initializeDatabase,
  createUser,
  findUser,
  getUsersWithRanks,
  updateUserScore,
  addClaimedRoadReward,
  getUserSnapshot,
  parseClaimedRoadRewards,
  serializeClaimedRoadRewards,
  getScoreTitle,
  getProgressSnapshot
};

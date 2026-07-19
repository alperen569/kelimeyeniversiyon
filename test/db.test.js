const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { initializeDatabase, createUser, getUsersWithRanks, updateUserScore, addClaimedRoadReward } = require('../db');

test('kullanıcı oluşturma ve skor güncelleme sqlite ile çalışır', async () => {
  const dbPath = path.join(__dirname, 'tmp-test.sqlite');
  if (require('node:fs').existsSync(dbPath)) {
    require('node:fs').unlinkSync(dbPath);
  }
  const db = initializeDatabase(dbPath, { migrateLegacy: false });

  createUser(db, { isim: 'testuser', sifre: '1234' });
  const users = getUsersWithRanks(db);
  assert.equal(users.length, 1);
  assert.equal(users[0].isim, 'testuser');

  updateUserScore(db, 'testuser', { score: 250, correct: 3, wrong: 1, totalQuestions: 4, taskPoints: 80 });
  const updated = getUsersWithRanks(db).find(user => user.isim === 'testuser');
  assert.equal(updated.puan, 250);
  assert.equal(updated.correct, 3);
  assert.equal(updated.wrong, 1);
  assert.equal(updated.totalQuestions, 4);
  assert.equal(updated.taskPoints, 80);

  addClaimedRoadReward(db, 'testuser', 'r1:seed');
  const withReward = getUsersWithRanks(db).find(user => user.isim === 'testuser');
  assert.deepEqual(withReward.claimedRoadRewards, ['r1:seed']);
});

test('milestone claimed durumu claimedRoadRewards ile senkronize olur', async () => {
  const dbPath = path.join(__dirname, 'tmp-test-claimed.sqlite');
  if (require('node:fs').existsSync(dbPath)) {
    require('node:fs').unlinkSync(dbPath);
  }
  const db = initializeDatabase(dbPath, { migrateLegacy: false });

  createUser(db, { isim: 'claimuser', sifre: '1234' });
  updateUserScore(db, 'claimuser', { score: 0, taskPoints: 150, correct: 0, wrong: 0, totalQuestions: 0 });

  const beforeClaim = getUsersWithRanks(db).find(user => user.isim === 'claimuser');
  const seedMilestone = beforeClaim.currentMilestones.find(milestone => milestone.baseId === 'seed');
  assert.equal(seedMilestone.unlocked, true);
  assert.equal(seedMilestone.claimed, false);

  addClaimedRoadReward(db, 'claimuser', seedMilestone.id);
  const afterClaim = getUsersWithRanks(db).find(user => user.isim === 'claimuser');
  const claimedSeed = afterClaim.currentMilestones.find(milestone => milestone.id === seedMilestone.id);
  assert.equal(claimedSeed.claimed, true);
});

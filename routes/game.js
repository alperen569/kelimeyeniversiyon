const express = require("express");
const router = express.Router();

const db = require("../database");

// oyun puanı gönderme

router.post("/score", async (req, res) => {
  try {
    const { userId, score } = req.body;

    await db.query(
      `
INSERT INTO game_scores
(user_id,game,score)

VALUES
(?,?,?)
`,

      [userId, "Kelime Zinciri", score],
    );

    // toplam puanı güncelle

    await db.query(
      `
UPDATE users

SET total_score =
total_score + ?

WHERE id=?

`,

      [score, userId],
    );

    res.json({
      success: true,
    });
  } catch (err) {
    console.log(err);

    res.status(500).json({
      error: true,
    });
  }
});

// kullanıcının puanını getir

router.get(
  "/score/:id",

  async (req, res) => {
    const [rows] = await db.query(
      `
SELECT total_score
FROM users
WHERE id=?
`,

      [req.params.id],
    );

    res.json(rows[0]);
  },
);

module.exports = router;

require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const path = require("path");
const http = require("http");

const {
  initializeDatabase,
  createUser,
  findUser,
  getUsersWithRanks,
  updateUserScore,
  addClaimedRoadReward,
  getUserSnapshot,
  verifyPassword,
  upgradePasswordHashIfNeeded,
} = require("./db");

const app = express();

const isProduction = process.env.NODE_ENV === "production";

const PORT = Number(process.env.PORT) || 3000;

const sessionSecret = process.env.SESSION_SECRET || "gelisme_secret_key";

app.set("trust proxy", isProduction ? 1 : 0);

app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);

app.use(
  express.json({
    limit: "32kb",
  }),
);

app.use(
  session({
    secret: sessionSecret,

    resave: false,

    saveUninitialized: false,

    cookie: {
      maxAge: 1000 * 60 * 60,
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
    },
  }),
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  max: 20,

  standardHeaders: true,

  legacyHeaders: false,
});

async function start() {
  await initializeDatabase();

  console.log("MySQL bağlantısı hazır");
}

function getCurrentUsername(req) {
  return req.session?.username || null;
}

function requireAuth(req, res, next) {
  if (!req.session.loggedIn || !getCurrentUsername(req)) {
    return res.redirect("/pc/login.html");
  }

  next();
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pc", "login.html"));
});

app.get("/pc", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pc", "login.html"));
});

app.use("/pc", express.static(path.join(__dirname, "public", "pc")));

app.use(express.static(path.join(__dirname, "public")));

/*
 REGISTER
*/

app.post("/register", authLimiter, async (req, res) => {
  try {
    const isim = String(req.body.isim ?? req.body.username ?? "").trim();

    const sifre = String(req.body.sifre ?? req.body.password ?? "");

    if (!isim || !sifre) {
      return res.json({
        success: false,

        message: "Eksik bilgi",
      });
    }

    if (isim.length < 3 || isim.length > 32 || sifre.length < 6) {
      return res.json({
        success: false,

        message: "Geçersiz bilgi",
      });
    }

    const old = await findUser(isim);

    if (old) {
      return res.json({
        success: false,

        message: "Kullanıcı zaten var",
      });
    }

    await createUser({
      isim,

      sifre,
    });

    res.json({
      success: true,
    });
  } catch (err) {
    console.log(err);

    res.json({
      success: false,

      message: "Sunucu hatası",
    });
  }
});

/*
 LOGIN
*/

app.post("/login", authLimiter, async (req, res) => {
  try {
    const isim = String(req.body.isim ?? req.body.username ?? "").trim();

    const sifre = String(req.body.sifre ?? req.body.password ?? "");

    const user = await findUser(isim);

    if (!user || !verifyPassword(sifre, user.sifre)) {
      return res.json({
        success: false,

        message: "Hatalı giriş",
      });
    }

    await upgradePasswordHashIfNeeded(user.isim, user.sifre, sifre);

    req.session.loggedIn = true;

    req.session.username = user.isim;

    res.json({
      success: true,
    });
  } catch (err) {
    console.log(err);

    res.json({
      success: false,
    });
  }
});

app.post("/start-game", (req, res) => {
  if (!req.session.loggedIn) {
    return res.sendStatus(401);
  }

  req.session.inGame = true;

  res.json({
    success: true,
  });
});

app.get("/pc/anasayfa.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pc", "anasayfa.html"));
});
/*
 ME
*/

app.get("/me", async (req, res) => {
  const username = getCurrentUsername(req);

  if (!username) {
    return res.json({
      loggedIn: false,
    });
  }

  const snapshot = await getUserSnapshot(username);

  if (!snapshot) {
    return res.json({
      loggedIn: false,
    });
  }

  const users = await getUsersWithRanks();

  const rank = users.findIndex((u) => u.isim === username) + 1;

  res.json({
    loggedIn: true,

    isim: snapshot.isim,

    puan: snapshot.puan,

    taskPoints: snapshot.taskPoints,

    rank,

    correct: snapshot.correct,

    wrong: snapshot.wrong,

    totalQuestions: snapshot.totalQuestions,

    title: snapshot.title,

    roadProgressPercent: snapshot.roadProgressPercent,

    roadProgressValue: snapshot.roadProgressValue,

    roadProgressTotal: snapshot.roadProgressTotal,

    rotationIndex: snapshot.rotationIndex,

    rotationLabel: snapshot.rotationLabel,

    nextMilestone: snapshot.nextMilestone,

    currentMilestones: snapshot.currentMilestones || [],

    claimedRoadRewards: snapshot.claimedRoadRewards || [],
  });
});

/*
 LEADERBOARD
*/

app.get("/leaderboard", async (req, res) => {
  const limit = Number(req.query.limit) || 10;

  const users = await getUsersWithRanks();

  res.json({
    success: true,

    users: users.slice(0, limit).map((user) => ({
      isim: user.isim,

      puan: user.puan,

      rank: user.rank,
    })),
  });
});

/*
 SAVE SCORE
*/

app.post("/save-score", async (req, res) => {
  try {
    const username = getCurrentUsername(req);

    if (!username) {
      return res.json({
        success: false,

        message: "Giriş yok",
      });
    }

    const score = Number(req.body.score);

    if (Number.isNaN(score)) {
      return res.json({
        success: false,
      });
    }

    await updateUserScore(username, {
      score,

      taskPoints: Number(req.body.taskPoints) || 0,

      correct: Number(req.body.dogruSayisi) || 0,

      wrong: Number(req.body.yanlisSayisi) || 0,

      totalQuestions: Number(req.body.toplamSoru) || 0,
    });

    const user = await getUserSnapshot(username);

    const users = await getUsersWithRanks();

    const ranked = users.find((u) => u.isim === username);

    res.json({
      success: true,

      toplamPuan: user.puan,

      taskPoints: user.taskPoints,

      rank: ranked?.rank || 1,

      correct: user.correct,

      wrong: user.wrong,

      totalQuestions: user.totalQuestions,
      title: user.title,

      roadProgressPercent: user.roadProgressPercent,

      roadProgressValue: user.roadProgressValue,

      roadProgressTotal: user.roadProgressTotal,

      rotationIndex: user.rotationIndex,

      rotationLabel: user.rotationLabel,

      nextMilestone: user.nextMilestone,

      currentMilestones: user.currentMilestones || [],

      claimedRoadRewards: user.claimedRoadRewards || [],
    });
  } catch (err) {
    console.log(err);

    res.json({
      success: false,

      message: "Hata",
    });
  }
});

/*
 ROAD STATE
*/

app.get("/road-state", async (req, res) => {
  const username = getCurrentUsername(req);

  if (!username) {
    return res.json({
      loggedIn: false,
    });
  }

  const snapshot = await getUserSnapshot(username);

  if (!snapshot) {
    return res.json({
      loggedIn: false,
    });
  }

  res.json({
    loggedIn: true,

    score: snapshot.puan,

    taskPoints: snapshot.taskPoints,

    title: snapshot.title,

    progressPercent: snapshot.roadProgressPercent,

    roadProgressPercent: snapshot.roadProgressPercent,

    roadProgressValue: snapshot.roadProgressValue,

    roadProgressTotal: snapshot.roadProgressTotal,

    rotationIndex: snapshot.rotationIndex,

    rotationLabel: snapshot.rotationLabel,

    nextMilestone: snapshot.nextMilestone,

    currentMilestones: snapshot.currentMilestones || [],

    claimedRoadRewards: snapshot.claimedRoadRewards || [],
  });
});

/*
 ROAD CLAIM
*/

aapp.post("/road-claim", async (req, res) => {
  const username = getCurrentUsername(req);

  if (!username) {
    return res.json({
      success: false,
      message: "Giriş gerekli",
    });
  }

  const { milestoneId } = req.body;

  if (!milestoneId || typeof milestoneId !== "string") {
    return res.json({
      success: false,
      message: "Geçersiz ödül",
    });
  }

  const snapshot = await getUserSnapshot(username);

  if (!snapshot) {
    return res.json({
      success: false,
      message: "Kullanıcı bulunamadı",
    });
  }

  // Kullanıcının açtığı yolları kontrol et
  const milestone = (snapshot.currentMilestones || []).find(
    (m) => m.id === milestoneId,
  );

  if (!milestone) {
    return res.json({
      success: false,
      message: "Geçersiz milestone",
    });
  }

  if (!milestone.unlocked) {
    return res.json({
      success: false,
      message: "Bu ödül henüz açılmadı",
    });
  }

  if (
    snapshot.claimedRoadRewards &&
    snapshot.claimedRoadRewards.includes(milestoneId)
  ) {
    return res.json({
      success: false,
      message: "Bu ödül zaten alındı",
    });
  }

  const ok = await addClaimedRoadReward(username, milestoneId);

  if (!ok) {
    return res.json({
      success: false,
      message: "Kaydedilemedi",
    });
  }

  const updated = await getUserSnapshot(username);

  res.json({
    success: true,

    claimedRoadRewards: updated.claimedRoadRewards || [],

    currentMilestones: updated.currentMilestones || [],
  });
});

/*
 LOGOUT
*/

app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
      });
    }

    res.clearCookie("connect.sid");

    res.json({
      success: true,
    });
  });
});

/*
 START SERVER
*/

const server = http.createServer(app);

start()
  .then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log("Server çalışıyor → http://0.0.0.0:" + PORT);
    });
  })
  .catch((err) => {
    console.error("MySQL başlatma hatası:", err);

    process.exit(1);
  });

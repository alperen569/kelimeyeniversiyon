require("dotenv").config();

const express = require("express");
const validator = require("validator");
const Filter = require("leo-profanity");
const { zxcvbn } = require("@zxcvbn-ts/core");
Filter.loadDictionary("en", "tr");
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
  resetUserLevel,
  unlockNextLevel,
  addUserScore,
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
app.post("/reset-level", async (req, res) => {
  const username = getCurrentUsername(req);

  if (!username) {
    return res.json({
      success: false,
    });
  }

  await resetUserLevel(username);

  res.json({
    success: true,
  });
});
app.post("/complete-level", async (req, res) => {
  const username = getCurrentUsername(req);

  if (!username) {
    return res.json({
      success: false,
    });
  }

  const level = Number(req.body.level);

  if (!level) {
    return res.json({
      success: false,
    });
  }

  await unlockNextLevel(username, level);

  res.json({
    success: true,
  });
});
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
function getClientIP(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

function validatePassword(sifre) {
  if (!validator.isLength(sifre, { min: 10, max: 64 })) return false;

  if (!/[A-Z]/.test(sifre)) return false;

  if (!/[a-z]/.test(sifre)) return false;

  if (!/[0-9]/.test(sifre)) return false;

  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(sifre)) return false;

  if (/\s/.test(sifre)) return false;

  const result = zxcvbn(sifre);

  if (result.score < 3) return false;

  return true;
}
function requireAuth(req, res, next) {
  if (!req.session.loggedIn || !getCurrentUsername(req)) {
    return res.redirect("/pc/login.html");
  }

  next();
}

const gameRoutes = require("./routes/game");

app.use("/api/game", gameRoutes);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pc", "login.html"));
});

app.get("/pc", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pc", "login.html"));
});

app.use("/pc", express.static(path.join(__dirname, "public", "pc")));

app.get("/game/:token", requireAuth, async (req, res) => {
  const levels = {
    // İLKOKUL

    ilk1A8f3: {
      file: "kelime-okyanusu-ilkokul/ilkokul-level-1.html",
      level: 1,
      type: "ilkokul",
    },

    ilk2B7k9: {
      file: "kelime-okyanusu-ilkokul/ilkokul-level-2.html",
      level: 2,
      type: "ilkokul",
    },

    ilk3C91x: {
      file: "kelime-okyanusu-ilkokul/ilkokul-level-3.html",
      level: 3,
      type: "ilkokul",
    },

    // ORTAOKUL

    ort1D82m: {
      file: "kelime-okyanusu-ortaokul/ortaokul-level-1.html",
      level: 1,
      type: "ortaokul",
    },

    ort2F71p: {
      file: "kelime-okyanusu-ortaokul/ortaokul-level-2.html",
      level: 2,
      type: "ortaokul",
    },

    ort3G55q: {
      file: "kelime-okyanusu-ortaokul/ortaokul-level-3.html",
      level: 3,
      type: "ortaokul",
    },

    // LİSE

    lis1H91z: {
      file: "kelime-okyanusu-lise/lise-level-1.html",
      level: 1,
      type: "lise",
    },

    lis2K82v: {
      file: "kelime-okyanusu-lise/lise-level-2.html",
      level: 2,
      type: "lise",
    },

    lis3M44n: {
      file: "kelime-okyanusu-lise/lise-level-3.html",
      level: 3,
      type: "lise",
    },
  };

  const current = levels[req.params.token];

  if (!current) {
    return res.status(404).send("Geçersiz oyun bağlantısı");
  }

  const username = req.session.username;

  const user = await getUserSnapshot(username);

  const maxLevel = user.maxLevel || 1;

  if (current.level > maxLevel) {
    let redirectToken;

    if (current.type === "ilkokul") {
      redirectToken = "ilk1A8f3";
    } else if (current.type === "ortaokul") {
      redirectToken = "ort1D82m";
    } else {
      redirectToken = "lis1H91z";
    }

    return res.redirect("/game/" + redirectToken);
  }

  res.sendFile(path.join(__dirname, "public", "pc", current.file));
});

app.use(express.static(path.join(__dirname, "public")));

app.post("/register", authLimiter, async (req, res) => {
  try {
    const isim = String(req.body.isim ?? req.body.username ?? "").trim();

    const sifre = String(req.body.sifre ?? req.body.password ?? "");
    const ip = getClientIP(req);

    const ipCount = registerIPs.get(ip) || 0;

    if (ipCount >= 3) {
      return res.json({
        success: false,

        message: "Bu IP adresinden maksimum 3 hesap oluşturabilirsiniz",
      });
    }

    if (!isim || !sifre) {
      return res.json({
        success: false,

        message: "Eksik bilgi",
      });
    }

    if (!validateUsername(isim)) {
      return res.json({
        success: false,

        message: "Geçersiz kullanıcı adı",
      });
    }

    if (containsBadWord(isim)) {
      return res.json({
        success: false,
        message: "Kullanıcı adı uygun değil",
      });
    }
    if (!validatePassword(sifre)) {
      return res.json({
        success: false,

        message:
          "Şifre en az 8 karakter olmalı, büyük harf, küçük harf ve sayı içermeli",
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
    registerIPs.set(ip, ipCount + 1);
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
app.get("/game-score", async (req,res)=>{

  try {

    const username = getCurrentUsername(req);

    if(!username){
      return res.json({
        success:false,
        score:0
      });
    }


    const user = await getUserSnapshot(username);


    res.json({

      success:true,

      score:user.puan || 0

    });


  } catch(err){

    console.log(err);

    res.json({
      success:false,
      score:0
    });

  }

});
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
        success:false,
        message:"Giriş yok"
      });
    }


    const levelScore = Number(req.body.score);


    if (Number.isNaN(levelScore)) {

      return res.json({
        success:false,
        message:"Geçersiz puan"
      });

    }


    const current = await getUserSnapshot(username);


    await updateUserScore(username, {

      score: levelScore,


      taskPoints: current.taskPoints,


      correct:
        current.correct + (Number(req.body.correct) || 0),


      wrong:
        current.wrong + (Number(req.body.wrong) || 0),


      totalQuestions:
        current.totalQuestions + 1

    });



    const user = await getUserSnapshot(username);



    res.json({

      success:true,

      toplamPuan:user.puan

    });



  } catch(err){

    console.log("SAVE SCORE HATASI:",err);


    res.json({

      success:false,

      message:err.message

    });

  }

});
app.get("/home", (req,res)=>{
  res.sendFile(
    path.join(__dirname,"public","pc","anasayfa.html")
  );
});

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


app.post("/road-claim", async (req, res) => {
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

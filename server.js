require("dotenv").config();

const express = require("express");
const validator = require("validator");
const Filter = require("leo-profanity");
const zxcvbn = require("zxcvbn");
Filter.loadDictionary("en", "tr");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const {
  initializeDatabase,
  createUser,
  findUser,
  findEmail,
  verifyUserEmail,
  getUsersWithRanks,
  updateUserScore,
  updateUserLevelScore,
  clearUserLevelScore,
  addClaimedRoadReward,
  getUserSnapshot,
  verifyPassword,
  upgradePasswordHashIfNeeded,
  resetUserLevel,
  unlockNextLevel,
  addUserScore,
} = require("./db");

const app = express();
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,

  port: Number(process.env.MAIL_PORT),

  secure: false,

  auth: {
    user: process.env.MAIL_USER,

    pass: process.env.MAIL_PASS,
  },
});

const isProduction = process.env.NODE_ENV === "production";

const PORT = Number(process.env.PORT) || 3000;

const sessionSecret = process.env.SESSION_SECRET || "gelisme_secret_key";

app.set("trust proxy", isProduction ? 1 : 0);

app.use(helmet({ contentSecurityPolicy: false }));

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
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
const registerIPs = new Map();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 20, // En fazla 5 giriş denemesi
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Çok fazla giriş denemesi yaptınız. 15 dakika bekleyin.",
  },
});
app.use("/save-score", generalLimiter);
app.use("/road-claim", generalLimiter);

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
async function sendVerificationMail(email, token) {
  const link = `${process.env.SITE_URL}/verify-email?token=${token}`;

  await transporter.sendMail({
    from: process.env.MAIL_FROM,

    to: email,

    subject: "Kelime Okyanusu Hesap Doğrulama",

    html: `

<h2>Kelime Okyanusu</h2>

<p>Hesabını doğrulamak için aşağıdaki butona tıkla.</p>

<p>

<a href="${link}"

style="

display:inline-block;

padding:12px 20px;

background:#1565c0;

color:white;

text-decoration:none;

border-radius:8px;

">

Hesabı Doğrula

</a>

</p>

<p>

Bu bağlantı 24 saat geçerlidir.

</p>

`,
  });
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

// Kullanıcı adı doğrulama (sadece harf, rakam, Türkçe karakter ve alt çizgi, 3-20 karakter)
function validateUsername(username) {
  if (typeof username !== "string") return false;
  // Sadece güvenli karakterlere izin ver (XSS/enjeksiyon önlemi)
  return /^[a-zA-Z0-9çğıöşüÇĞİÖŞÜ_]{3,20}$/.test(username);
}

// Küfür/uygunsuz kelime kontrolü (leo-profanity ile)
function containsBadWord(text) {
  if (!text || typeof text !== "string") return false;
  return Filter.check(text); // Filter zaten yukarıda tanımlanmıştı
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
    const isim = String(req.body.isim ?? "").trim();

    const email = String(req.body.email ?? "")
      .trim()
      .toLowerCase();

    const sifre = String(req.body.sifre ?? "");

    const ip = getClientIP(req);

    const ipCount = registerIPs.get(ip) || 0;

    if (ipCount >= 3) {
      return res.json({
        success: false,

        message: "Bu IP adresinden en fazla 3 hesap oluşturabilirsiniz.",
      });
    }

    if (!isim || !email || !sifre) {
      return res.json({
        success: false,

        message: "Lütfen bütün alanları doldurun.",
      });
    }

    if (!validator.isEmail(email)) {
      return res.json({
        success: false,

        message: "Geçerli bir e-posta adresi girin.",
      });
    }

    if (!validateUsername(isim)) {
      return res.json({
        success: false,

        message: "Geçersiz kullanıcı adı.",
      });
    }

    if (containsBadWord(isim)) {
      return res.json({
        success: false,

        message: "Bu kullanıcı adı kullanılamaz.",
      });
    }

    if (!validatePassword(sifre)) {
      return res.json({
        success: false,

        message: "Şifre yeterince güçlü değil.",
      });
    }

    const oldUser = await findUser(isim);

    if (oldUser) {
      return res.json({
        success: false,

        message: "Bu kullanıcı adı zaten kullanılıyor.",
      });
    }

    const oldEmail = await findEmail(email);

    if (oldEmail) {
      return res.json({
        success: false,

        message: "Bu e-posta zaten kayıtlı.",
      });
    }

    const verificationToken = require("crypto").randomBytes(32).toString("hex");

    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await createUser({
      isim,

      email,

      sifre,

      verificationToken,

      verificationExpires,
    });

    await sendVerificationMail(
      email,

      verificationToken,
    );

    registerIPs.set(ip, ipCount + 1);

    res.json({
      success: true,

      message: "Kayıt başarılı. Lütfen e-posta adresinizi doğrulayın.",
    });
  } catch (err) {
    console.log(err);

    res.json({
      success: false,

      message: "Sunucu hatası.",
    });
  }
});

app.post("/login", authLimiter, async (req, res) => {
  try {
    const isim = String(req.body.isim ?? req.body.username ?? "").trim();

    const sifre = String(req.body.sifre ?? req.body.password ?? "");

const user = await findUser(isim);

if(!user){

    return res.json({

        success:false,

        message:"Kullanıcı bulunamadı."

    });

}

if(!verifyPassword(sifre,user.sifre)){

    return res.json({

        success:false,

        message:"Şifre yanlış."

    });

}

if(!user.email_verified){

    return res.json({

        success:false,

        message:"Lütfen önce e-posta adresinizi doğrulayın."

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
app.get("/verify-email",async(req,res)=>{

    try{

        const token=String(req.query.token || "");

        if(!token){

            return res.send("<h2>Geçersiz bağlantı.</h2>");

        }

        const ok=await verifyUserEmail(token);

        if(!ok){

            return res.send(`

<h2>

Bağlantı geçersiz veya süresi dolmuş.

</h2>

`);

        }

        res.send(`

<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<title>Doğrulandı</title>

</head>

<body
style="

font-family:Arial;

background:#081321;

color:white;

display:flex;

justify-content:center;

align-items:center;

height:100vh;

flex-direction:column;

">

<h1>

✅ Hesabınız doğrulandı.

</h1>

<p>

Artık giriş yapabilirsiniz.

</p>

<a href="/pc/login.html">

Giriş Yap

</a>

</body>

</html>

`);

    }

    catch(err){

        console.log(err);

        res.send("Sunucu hatası.");

    }

});
app.post("/start-game", async (req, res) => {
  if (!req.session.loggedIn) {
    return res.sendStatus(401);
  }

  req.session.inGame = true;

  const username = getCurrentUsername(req);

  if (username) {
    try {
      await clearUserLevelScore(username);
    } catch (err) {
      console.log("LEVEL SCORE RESET HATASI:", err);
    }
  }

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
app.get("/game-score", async (req, res) => {
  try {
    const username = getCurrentUsername(req);

    if (!username) {
      return res.json({
        success: false,
        score: 0,
      });
    }

    const user = await getUserSnapshot(username);

    res.json({
      success: true,

      score: user.levelScore || 0,

      levelScore: user.levelScore || 0,
    });
  } catch (err) {
    console.log(err);

    res.json({
      success: false,
      score: 0,
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

    levelScore: snapshot.levelScore,

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

    const levelScore = Math.max(
      0,
      Math.min(Number(req.body.score) || 0, 99999),
    );

    if (Number.isNaN(levelScore)) {
      return res.json({
        success: false,
        message: "Geçersiz puan",
      });
    }

    const scoreMode = String(req.body.scoreMode || "").toLowerCase();
    const scoreScope = String(
      req.body.scoreScope || req.body.scope || "",
    ).toLowerCase();
    const finalizeLevelScore =
      req.body.finalizeLevelScore === true ||
      String(req.body.finalizeLevelScore || "").toLowerCase() === "true";
    const isAbsoluteScore = scoreMode === "absolute" || scoreMode === "replace";
    const isLevelScore = scoreScope === "level" || scoreScope === "level-score";
    const correct = Math.max(0, Math.min(Number(req.body.correct) || 0, 999));

    const wrong = Math.max(0, Math.min(Number(req.body.wrong) || 0, 999));

    const totalQuestions =
      Number(
        req.body.totalQuestions ?? req.body.toplamSoru ?? correct + wrong,
      ) || 0;
    const taskPoints = Number(req.body.taskPoints ?? 0) || 0;

    if (isLevelScore) {
      await updateUserLevelScore(username, {
        levelScore,
        taskPoints,
        correct,
        wrong,
        totalQuestions,
      });
    } else {
      await updateUserScore(username, {
        score: levelScore,
        taskPoints,
        correct,
        wrong,
        totalQuestions,
        mode: isAbsoluteScore ? "absolute" : "add",
      });

      if (finalizeLevelScore) {
        await clearUserLevelScore(username);
      }
    }

    const user = await getUserSnapshot(username);

    res.json({
      success: true,

      toplamPuan: user.puan,
    });
  } catch (err) {
    console.log("SAVE SCORE HATASI:", err);

    res.json({
      success: false,

      message: err.message,
    });
  }
});
app.get("/home", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pc", "anasayfa.html"));
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
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "pc", "404.html"));
});
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

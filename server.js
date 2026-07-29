require("dotenv").config();

const express = require("express");
const validator = require("validator");
const Filter = require("leo-profanity");
Filter.loadDictionary("en");
Filter.loadDictionary("tr");
const zxcvbn = require("zxcvbn");
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
  secure: false, // genelde 587 için false
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
windowMs: 2 * 60 * 1000, 
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Çok fazla giriş denemesi yaptınız. Birkaç dakika bekleyin.",
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

function validateUsername(username) {
  if (typeof username !== "string") return false;
  return /^[a-zA-Z0-9çğıöşüÇĞİÖŞÜ_]{3,20}$/.test(username);
}

function containsBadWord(text) {
    if (!text || typeof text !== "string") return false;
    return Filter.hasBadWord(text);  
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
app.get("/verify-email", async (req, res) => {
    try {
        const token = String(req.query.token || "");
        if (!token) {
            return res.send("<h2>Geçersiz bağlantı.</h2>");
        }
        const user = await verifyUserEmail(token);
        if (!user) {
            return res.send(`
                <h2>Bağlantı geçersiz veya süresi dolmuş.</h2>
            `);
        }

        try {
            await transporter.sendMail({
                from: `"Kelime Okyanusu" <${process.env.MAIL_FROM}>`,
                to: user.email,
                subject: "🎉 Kelime Okyanusu'na Hoş Geldin!",
                html: `
                    <div style="max-width:650px;margin:auto;background:#081321;padding:40px;border-radius:20px;color:#ffffff;font-family:Arial,sans-serif;">
                        <h1 style="text-align:center;color:#4da3ff;">🌊 Kelime Okyanusu'na Hoş Geldin!</h1>
                        <p>Merhaba <b>${user.isim}</b>,</p>
                        <p>E-posta adresini başarıyla doğruladığın için teşekkür ederiz. Artık hesabın tamamen aktif.</p>
                        <hr style="border:none;border-top:1px solid #244a8a;margin:30px 0;">
                        <h2>🎮 Seni Neler Bekliyor?</h2>
                        <ul>
                            <li>🧩 Eğlenceli kelime bulmacaları</li>
                            <li>🏆 Puan sistemi</li>
                            <li>📚 Kelime hazneni geliştirecek yüzlerce kelime</li>
                            <li>⭐ Zorluk seviyesi artan bölümler</li>
                            <li>🎯 Kendini geliştirebileceğin eğitici içerikler</li>
                        </ul>
                        <p>Her bölümde yeni kelimeler keşfedecek, puan kazanacak ve seviyeni yükselteceksin.</p>
                        <div style="text-align:center;margin:40px 0;">
                            <a href="https://kelimeokyanusu.com.tr/pc/login.html" style="background:#2563eb;color:white;padding:16px 35px;text-decoration:none;border-radius:10px;font-weight:bold;display:inline-block;">Oyuna Başla</a>
                        </div>
                        <p style="color:#b8c7e8;">Herhangi bir sorun yaşarsan bizimle iletişime geçebilirsin.</p>
                        <p>İyi eğlenceler! 🌊<br><b>Kelime Okyanusu Ekibi</b></p>
                    </div>
                `
            });
        } catch (mailErr) {
            console.log("Hoş geldin maili gönderilemedi:", mailErr);
        }

        res.send(`
            <!DOCTYPE html>
            <html lang="tr">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>E-posta Doğrulandı</title>
                <style>
                    * { margin:0; padding:0; box-sizing:border-box; font-family:Arial,Helvetica,sans-serif; }
                    body {
                        display:flex; justify-content:center; align-items:center; min-height:100vh; overflow:hidden;
                        background:linear-gradient(-45deg, #020617, #0b1638, #123a7a, #0b1638, #020617);
                        background-size:400% 400%;
                        animation:bg 15s ease infinite;
                    }
                    .card {
                        width:90%; max-width:500px;
                        background:rgba(11,22,56,.75);
                        backdrop-filter:blur(18px);
                        border:1px solid rgba(255,255,255,.08);
                        border-radius:24px;
                        padding:40px 30px;
                        text-align:center;
                        box-shadow:0 20px 60px rgba(0,0,0,.45);
                        animation:popup .7s ease;
                    }
                    .icon {
                        width:95px; height:95px;
                        margin:auto;
                        border-radius:50%;
                        background:#22c55e;
                        display:flex; justify-content:center; align-items:center;
                        font-size:52px;
                        animation:success 1s ease;
                    }
                    h1 { margin-top:25px; font-size:2rem; color:white; }
                    p { margin-top:18px; color:#b9c7ea; line-height:1.7; }
                    .btn {
                        display:inline-block; margin-top:35px; padding:14px 35px;
                        background:#2563eb; color:white; text-decoration:none; font-weight:bold;
                        border-radius:12px; transition:.25s;
                    }
                    .btn:hover { background:#3b82f6; transform:translateY(-2px); }
                    body::before, body::after {
                        content:""; position:absolute; width:700px; height:700px;
                        border-radius:50%; filter:blur(120px); opacity:.18;
                    }
                    body::before { background:#2563eb; top:-250px; left:-250px; animation:float 14s infinite; }
                    body::after { background:#06b6d4; bottom:-250px; right:-250px; animation:float 14s infinite reverse; }
                    @keyframes bg { 0%{background-position:0% 50%;} 50%{background-position:100% 50%;} 100%{background-position:0% 50%;} }
                    @keyframes popup { from{opacity:0;transform:scale(.8);} to{opacity:1;transform:scale(1);} }
                    @keyframes success { 0%{transform:scale(0);} 70%{transform:scale(1.15);} 100%{transform:scale(1);} }
                    @keyframes float { 0%,100%{transform:translate(0,0);} 50%{transform:translate(80px,-40px);} }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="icon">✔</div>
                    <h1>E-posta Doğrulandı</h1>
                    <p>
                        Tebrikler! Hesabınız başarıyla doğrulandı.
                        <br><br>
                        Artık <b>Kelime Okyanusu</b>'na giriş yapabilir ve kelime maceranıza başlayabilirsiniz.
                    </p>
                    <a class="btn" href="/pc/login.html">Giriş Yap</a>
                    <p style="margin-top:18px;font-size:14px;color:#8ea5d8;">
                        5 saniye içinde otomatik olarak giriş sayfasına yönlendirileceksiniz...
                    </p>
                </div>
                <script>
                    setTimeout(() => { window.location.href = "/pc/login.html"; }, 5000);
                </script>
            </body>
            </html>
        `);
    } catch (err) {
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
  try {
    const username = getCurrentUsername(req);

    if (!username) {
      return res.json({ loggedIn: false });
    }

const snapshot = await getUserSnapshot(username);

if (!snapshot) {
  return res.json({ loggedIn: false });
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
  } catch (err) {
    console.log("/me HATASI:", err.message);
    console.log("Stack:", err.stack);
    res.json({ loggedIn: false });
  }
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

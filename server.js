require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
app.use(helmet());
const session = require("express-session");
const path = require("path");
const http = require("http");
const { initializeDatabase, createUser, findUser, getUsersWithRanks, updateUserScore, addClaimedRoadReward, getUserSnapshot, getProgressSnapshot, getScoreTitle } = require("./db");

const app = express();
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60,
        httpOnly: true,
        secure: true,
        sameSite: "lax"
}
}));
const server = http.createServer(app);
const PORT = 3000;
const db = initializeDatabase();
const gameRoutes = {
  "/ilkokul-level-1": "Kelime OKyanusu İLKOKUL/İLKOKUL level 1.html",
  "/ilkokul-level-2": "Kelime OKyanusu İLKOKUL/İLKOKUL level 2.html",
  "/ilkokul-level-3": "Kelime OKyanusu İLKOKUL/İLKOKUL level 3.html",

  "/ortaokul-level-1": "Kelime OKyanusu ORTAOKUL/ORTAOKUL level 1.html",
  "/ortaokul-level-2": "Kelime OKyanusu ORTAOKUL/ORTAOKUL level 2.html",
  "/ortaokul-level-3": "Kelime OKyanusu ORTAOKUL/ORTAOKUL level 3.html",

  "/lise-level-1": "Kelime Okyanusu LİSE/LİSE level 1.html",
  "/lise-level-2": "Kelime Okyanusu LİSE/LİSE level 2.html",
  "/lise-level-3": "Kelime Okyanusu LİSE/LİSE level 3.html"
};

app.use(express.json());

function getCookieValue(req, name) {
  const header = req.headers.cookie || "";
  const cookies = header.split(";").map(part => part.trim()).filter(Boolean);
  const pair = cookies.find(cookie => cookie.startsWith(`${name}=`));
  if (!pair) return null;
  return decodeURIComponent(pair.slice(name.length + 1));
}

function getCurrentUsername(req) {
  return getCookieValue(req, "kw_user");
}

function setLoginCookie(res, isim) {
  res.setHeader("Set-Cookie", `kw_user=${encodeURIComponent(isim)}; Path=/; SameSite=Lax`);
}

function clearLoginCookie(res) {
  res.setHeader("Set-Cookie", "kw_user=; Path=/; Max-Age=0; SameSite=Lax");
}

function getActiveUserSnapshot(username) {
  if (!username) return null;
  const snapshot = getUserSnapshot(db, username);
  if (!snapshot) {
    return null;
  }
  return {
    ...snapshot,
    rank: getUsersWithRanks(db).findIndex(user => user.isim === username) + 1
  };
}

function getLeaderboard(limit) {
  const users = getUsersWithRanks(db);

  if (typeof limit === "number" && limit > 0) {
    return users.slice(0, limit);
  }

  return users;
}

function buildRoadStateResponse(snapshot) {
  const currentMilestones = snapshot.currentMilestones || [];
  return {
    loggedIn: true,
    score: snapshot.puan,
    taskPoints: snapshot.taskPoints || 0,
    title: snapshot.title,
    progressPercent: snapshot.roadProgressPercent,
    roadProgressPercent: snapshot.roadProgressPercent,
    roadProgressValue: snapshot.roadProgressValue,
    roadProgressTotal: snapshot.roadProgressTotal,
    rotationIndex: snapshot.rotationIndex,
    rotationLabel: snapshot.rotationLabel,
    nextMilestone: snapshot.nextMilestone,
    nextRotationStart: snapshot.nextRotationStart,
    milestones: currentMilestones,
    currentMilestones,
    claimedRoadRewards: snapshot.claimedRoadRewards || []
  };
}


app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pc", "login.html"));
}); 


app.get("/pc", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pc", "login.html"));
});



app.use(["/pc/cokoyunculu", "/pc/cokoyunculu.html"], (req, res) => {
  res.status(404).send("Cok oyunculu ozellik kaldirildi.");
});
Object.entries(gameRoutes).forEach(([route, file]) => {

    app.get(route, (req, res) => {

        if (!req.session.loggedIn) {
            return res.redirect("/pc/login.html");
        }

        if (!req.session.inGame) {
            return res.redirect("/pc/anasayfa.html");
        }

        res.sendFile(
            path.join(__dirname, "public", "games", file)
        );

    });

});
// STATIC DOSYALAR
app.use("/pc", (req, res, next) => {

    // Login sayfası herkese açık
    if (
        req.path === "/" ||
        req.path === "/login.html" 
    ) {
        return next();
    }

    // CSS, JS, resimler serbest
    if (
        req.path.endsWith(".css") ||
        req.path.endsWith(".js") ||
        req.path.endsWith(".png") ||
        req.path.endsWith(".jpg") ||
        req.path.endsWith(".jpeg") ||
        req.path.endsWith(".gif") ||
        req.path.endsWith(".svg") ||
        req.path.endsWith(".ico") ||
        req.path.endsWith(".woff") ||
        req.path.endsWith(".woff2")
    ) {
        return next();
    }

    // Giriş yapılmamışsa
    if (!req.session.loggedIn) {
        return res.redirect("/pc/login.html");
    }

    // Level sayfaları sadece Başlat'tan sonra açılsın
    if (req.path.includes("Level")) {

        if (!req.session.inGame) {
            return res.redirect("/pc/anasayfa.html");
        }

    }

    next();

});

app.use("/pc", express.static(path.join(__dirname, "public", "pc")));
app.use(express.static(path.join(__dirname, "public")));

// KAYIT OL
app.post("/register", (req, res) => {
  const { isim, sifre } = req.body;
  if (!isim || !sifre) {
    return res.json({ success: false, message: "Eksik bilgi" });
  }

  const existing = findUser(db, isim);
  if (existing) {
    return res.json({ success: false, message: "Bu kullanıcı zaten var" });
  }

  createUser(db, { isim, sifre });
  res.json({ success: true });
});

// GİRİŞ
app.post("/login", (req, res) => {
  const { isim, sifre } = req.body;
  if (!isim || !sifre) {
    return res.json({ success: false, message: "Eksik bilgi" });
  }

  const user = findUser(db, isim);
  if (!user || user.sifre !== sifre) {
    return res.json({ success: false, message: "Hatalı kullanıcı adı veya şifre" });
  }

  setLoginCookie(res, user.isim);
  req.session.loggedIn = true;
  res.json({ success: true });
});
app.post("/start-game", (req, res) => {

    if (!req.session.loggedIn) {
        return res.sendStatus(401);
    }

    req.session.inGame = true;

    res.json({ success: true });

});
// ANASAYFA KORUMA - PC
app.get("/pc/anasayfa.html", (req, res) => {
  if (!getCurrentUsername(req)) {
    return res.redirect("/pc");
  }
  res.sendFile(path.join(__dirname, "public", "pc", "anasayfa.html"));
});




app.get("/pc/kelime_avı.html", (req, res) => {
  if (!getCurrentUsername(req)) {
    return res.redirect("/pc/login.html");
  }
  res.sendFile(path.join(__dirname, "public", "pc", "kelime_avı.html"));
});

// AKTİF KULLANICI + PUAN + SIRALAMA
app.get("/me", (req, res) => {
  const currentUser = getCurrentUsername(req);
  if (!currentUser) {
    return res.json({ loggedIn: false });
  }

  const snapshot = getActiveUserSnapshot(currentUser);
  if (!snapshot) {
    return res.json({ loggedIn: false });
  }

  res.json({
    loggedIn: true,
    isim: currentUser,
    puan: snapshot.puan,
    taskPoints: snapshot.taskPoints || 0,
    rank: snapshot.rank,
    successRate: snapshot.successRate,
    correct: snapshot.correct,
    wrong: snapshot.wrong,
    totalQuestions: snapshot.totalQuestions,
    title: snapshot.title,
    roadProgressPercent: snapshot.roadProgressPercent,
    roadProgressValue: snapshot.roadProgressValue,
    roadProgressTotal: snapshot.roadProgressTotal,
    rotationIndex: snapshot.rotationIndex,
    rotationLabel: snapshot.rotationLabel,
    nextRotationStart: snapshot.nextRotationStart,
    nextMilestone: snapshot.nextMilestone,
    claimedRoadRewards: snapshot.claimedRoadRewards || [],
    currentMilestones: snapshot.currentMilestones || []
  });
});

app.get("/leaderboard", (req, res) => {
  const limit = Number(req.query.limit) || 10;
  const users = getLeaderboard(limit).map(user => ({
    isim: user.isim,
    puan: user.puan,
    rank: user.rank
  }));
  res.json({ success: true, users });
});

// SKOR KAYDET -> PUANI ARTIR, DOSYADA SIRA NUMARASINI KORU
app.post("/save-score", (req, res) => {
  const { score, dogruSayisi, yanlisSayisi, toplamSoru } = req.body;
  const currentUser = getCurrentUsername(req);
  if (!currentUser || typeof score !== "number") {
    return res.json({ success: false, message: "Geçersiz istek" });
  }

  const user = findUser(db, currentUser);
  if (!user) {
    return res.json({ success: false, message: "Kullanıcı bulunamadı" });
  }

  const taskPoints = Number(req.body.taskPoints) || 0;
  updateUserScore(db, currentUser, {
    score: Number(score) || 0,
    taskPoints,
    correct: Number(dogruSayisi) || 0,
    wrong: Number(yanlisSayisi) || 0,
    totalQuestions: Number(toplamSoru) || 0
  });

  const updatedUser = getUsersWithRanks(db).find(item => item.isim === currentUser);
  const updatedPuan = updatedUser ? updatedUser.puan : Number(user.puan) || 0;
  const updatedRank = updatedUser ? updatedUser.rank : 1;
  const updatedSuccessRate = updatedUser ? updatedUser.successRate : 0;
  const updatedCorrect = updatedUser ? updatedUser.correct : 0;
  const updatedWrong = updatedUser ? updatedUser.wrong : 0;
  const updatedTotalQuestions = updatedUser ? updatedUser.totalQuestions : 0;

  res.json({
    success: true,
    toplamPuan: updatedPuan,
    rank: updatedRank,
    successRate: updatedSuccessRate,
    correct: updatedCorrect,
    wrong: updatedWrong,
    totalQuestions: updatedTotalQuestions,
    title: getScoreTitle(updatedPuan),
    taskPoints: updatedUser ? updatedUser.taskPoints || 0 : 0,
    ...getProgressSnapshot(updatedPuan, updatedUser ? updatedUser.claimedRoadRewards || [] : [], updatedUser ? updatedUser.taskPoints || 0 : 0)
  });
});

app.get("/road-state", (req, res) => {
  const currentUser = getCurrentUsername(req);
  if (!currentUser) {
    return res.json({ loggedIn: false });
  }

  const snapshot = getActiveUserSnapshot(currentUser);
  if (!snapshot) {
    return res.json({ loggedIn: false });
  }

  res.json(buildRoadStateResponse(snapshot));
});

app.post("/road-claim", (req, res) => {
  const currentUser = getCurrentUsername(req);
  if (!currentUser) {
    return res.json({ success: false, message: "Giriş gerekli" });
  }

  const { milestoneId } = req.body || {};
  if (!milestoneId || typeof milestoneId !== "string") {
    return res.json({ success: false, message: "milestoneId gerekli" });
  }

  const beforeSnapshot = getActiveUserSnapshot(currentUser);
  if (!beforeSnapshot) {
    return res.json({ success: false, message: "Kullanıcı bulunamadı" });
  }

  const milestone = (beforeSnapshot.currentMilestones || []).find(item => item.id === milestoneId);
  if (!milestone) {
    return res.json({ success: false, message: "Geçersiz milestone" });
  }
  if (!milestone.unlocked) {
    return res.json({ success: false, message: "Bu adım henüz açılmadı" });
  }
  if (milestone.claimed) {
    return res.json({ success: false, message: "Bu ödül zaten alındı" });
  }

  const ok = addClaimedRoadReward(db, currentUser, milestoneId);
  if (!ok) {
    return res.json({ success: false, message: "Ödül kaydedilemedi" });
  }

  const snapshot = getActiveUserSnapshot(currentUser);
  if (!snapshot) {
    return res.json({ success: false, message: "Kullanıcı snapshot üretilemedi" });
  }

  return res.json({
    success: true,
    milestone: snapshot.nextMilestone,
    title: snapshot.title,
    claimedRoadRewards: snapshot.claimedRoadRewards || [],
    currentMilestones: snapshot.currentMilestones || [],
    roadProgressPercent: snapshot.roadProgressPercent,
    roadProgressValue: snapshot.roadProgressValue,
    roadProgressTotal: snapshot.roadProgressTotal
  });
});

// ÇIKIŞ YAP
app.post("/logout", (req, res) => {
  clearLoginCookie(res);
  res.json({ success: true });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Server çalışıyor → http://0.0.0.0");
});

# TODO - kelimeyeniversiyon temizleme & hata düzeltme

- [x] Plan onaylandı: `server.js` içinde tekrar eden yardımcıları kaldırıp `db.js` yardımcılarını kullanmak
- [x] `server.js` içindeki road state/claim akışını düzeltmek
  - [x] `/road-state`: `snapshot.currentMilestones` ile tutarlı response döndürmek
  - [x] `/road-claim`: body'den `milestoneId` alıp `addClaimedRoadReward` ile gerçek claim yapmak
- [x] `server.js` içindeki global aktif kullanıcı/puan/rank kullanımını minimal bozmadan endpointleri request bazlı sadeleştirmek
- [x] `server.js` gereksiz boş/yarım fonksiyonları (örn. `getBadgeCatalog`) kaldırmak/temizlemek

- [x] Test/çalıştırma
  - [x] `node server.js` ile başlatıp temel endpointlerin hata vermediğini kontrol etmek
  - [x] `node --test test/db.test.js` ile sqlite testlerini koşturmak

## Kalan iyileştirmeler (opsiyonel)

- [ ] Şifreleri hash'le (bcrypt)
- [ ] Kullanılmayan bağımlılıkları kaldır (`express-session`, `cors`)
- [ ] Tüm oyun sayfalarına giriş koruması ekle
- [ ] Mobil anasayfaya ilerleme yolu (road) arayüzü ekle

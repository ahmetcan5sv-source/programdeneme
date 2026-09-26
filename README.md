# AYBÜ Program Yapıcı

AYBÜ öğrencileri için çakışmasız ders programı oluşturucu. Sunucu gerektirmeyen statik bir sitedir, GitHub Pages'te çalışır.

Şu an Mühendislik ve Doğa Bilimleri, İşletme ve Hukuk fakültelerini kapsar.

## Kurallar

- Öğrenci kendi fakültesindeki bölümlerin derslerini ve en fazla 1 rektörlük ortak seçmeli dersini alabilir.
- ENGR dersleri yalnızca Mühendislik Fakültesi öğrencilerine açıktır.
- Bitirme projesi, staj ve ENGR450 yalnızca öğrencinin kendi bölümünün şubesinden alınabilir.
- Açma nedeni "Staj" olan dersler çakışma kontrolüne girmez.

## Veriyi güncelleme

1. OBS ders seçim ekranındaki listeyi (her program için) kopyalayıp `data/src/obs/` klasörüne `.txt` olarak kaydet.
   Zorunlu/seçmeli, sınıf, AKTS, hoca ve saatler buradan okunur.
2. OBS listesinde olmayan dersler:
   - `data/src/ENGR.csv` (isteğe bağlı): OBS listesinde olmayan ENGR dersleri
   - `data/src/rektorluk.csv`: rektörlük ortak seçmelileri
3. Derslik bilgisi OBS listesinde yok; varsa `data/src/derslik_<BÖLÜM>.csv` dosyalarına eklenir.
4. Ön koşullar: `data/src/prereq.csv`
5. Yeni bir bölüm eklerken `tools/build.py` içindeki `PROGRAMS` listesine ekle.
6. Derle: `python tools/build.py` (çıktı `data/courses.js`).

## Yayınlama notu

`index.html` içindeki `?v=` numarasını her güncellemede bir artır. Bu sayede tarayıcılar önbellekteki eski dosyaları kullanmaz.

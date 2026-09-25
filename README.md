# AYBÜ Program Yapıcı

AYBÜ Mühendislik öğrencileri için çakışmasız ders programı oluşturucu. Sunucu gerektirmeyen statik bir sitedir, GitHub Pages'te çalışır.

## Veriyi güncelleme

1. `data/src/<BÖLÜM>.csv` dosyalarını düzenle (Excel ile açılabilir). Her satır bir ders bloğudur:
   `code,section,year,day,start,end,room,instructor`
   - `day`: Pzt, Sal, Çar, Per, Cum
   - `section`: Bölüm içinde birden fazla şube varsa numarası (1, 2...), yoksa boş
   - Aynı ders kodu farklı bölümlerde açılmışsa her biri ayrı şube olarak görünür.
2. Rektörlük ortak dersleri `data/src/rektorluk.csv` dosyasına, ENGR dersleri `data/src/ENGR.csv` dosyasına girer.
3. Ders adları `data/src/names.csv` içindedir.
4. Derle: `python tools/build.py` (çıktı `data/courses.js`).

Kaynak PDF'ler `kaynak/` klasöründedir.

## Yerelde çalıştırma

`index.html` dosyasını tarayıcıda açmak yeterlidir.

## Yayınlama notu

`index.html` içindeki `?v=` numarasını her güncellemede bir artır. Bu sayede tarayıcılar önbellekteki eski dosyaları kullanmaz.

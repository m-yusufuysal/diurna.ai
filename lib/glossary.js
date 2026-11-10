'use strict';
/* Yaptırım alanı sözlüğü: çeviri ve YZ özelliklerinde tutarlı terim kullanımı. [en, tr, ar] */
const G = [
  ['designation / to designate (sanctions listing)', 'listeleme / listeye alma', 'إدراج'],
  ['delisting / removal from the list', 'listeden çıkarma', 'الرفع من القائمة'],
  ['general licence', 'genel lisans', 'ترخيص عام'], ['specific licence', 'özel lisans', 'ترخيص خاص'],
  ['asset freeze / to freeze assets', 'mal varlığının dondurulması', 'تجميد الأصول'],
  ['sanctions', 'yaptırımlar', 'العقوبات'], ['restrictive measures', 'kısıtlayıcı tedbirler', 'التدابير التقييدية'],
  ['consolidated list', 'konsolide liste', 'القائمة الموحدة'], ['Specially Designated Nationals (SDN)', 'Özel Olarak Belirlenmiş Kişiler (SDN)', 'الأشخاص المعيّنون بشكل خاص (SDN)'],
  ['beneficial owner', 'nihai fayda sahibi', 'المستفيد الفعلي'], ['50 percent rule', '%50 kuralı', 'قاعدة الـ50 بالمئة'],
  ['customer base screening / match determination ("base tespiti")', 'base tespiti (müşteri tabanında eşleşme tespiti)', 'تحديد المطابقة في قاعدة العملاء'],
  ['possible match / false positive', 'olası eşleşme / yanlış pozitif', 'مطابقة محتملة / إيجابية كاذبة'],
  ['enhanced due diligence (EDD)', 'güçlendirilmiş müşteri tanıma (EDD)', 'العناية الواجبة المعززة'],
  ['correspondent bank', 'muhabir banka', 'بنك مراسل'], ['four-eyes principle', 'dört göz ilkesi', 'مبدأ العينين'],
  ['dual-use goods', 'çift kullanımlı ürünler', 'السلع ذات الاستخدام المزدوج'], ['vessel', 'gemi', 'سفينة'],
  ['civil monetary penalty', 'idari para cezası', 'غرامة مالية مدنية'], ['enforcement action', 'uygulama/yaptırım işlemi', 'إجراء إنفاذ'],
  ['Official Journal of the European Union', 'Avrupa Birliği Resmî Gazetesi', 'الجريدة الرسمية للاتحاد الأوروبي'],
  ['Council Regulation / Implementing Regulation', 'Konsey Tüzüğü / Uygulama Tüzüğü', 'لائحة المجلس / لائحة التنفيذ'],
  ['Federal Register', 'Federal Register (ABD Resmî Gazetesi)', 'السجل الفيدرالي'],
  ['FATF black list / grey list', 'FATF kara liste / gri liste', 'القائمة السوداء / الرمادية لمجموعة العمل المالي'],
  ['MASAK (Financial Crimes Investigation Board)', 'MASAK (Mali Suçları Araştırma Kurulu)', 'مجلس التحقيق في الجرائم المالية (MASAK)'],
  ['Resmî Gazete (Official Gazette of Türkiye)', 'Resmî Gazete', 'الجريدة الرسمية التركية'],
  ['general licence / FAQ / guidance', 'genel lisans / SSS / rehber', 'ترخيص عام / أسئلة شائعة / إرشادات'],
  ['transaction / payment', 'işlem / ödeme', 'معاملة / دفعة'], ['screening', 'tarama', 'الفحص'],
  ['watchlist', 'izleme listesi', 'قائمة المراقبة'], ['Know Your Customer (KYC)', 'müşterini tanı (KYC)', 'اعرف عميلك (KYC)'],
];
const col = lang => (lang === 'tr' ? 1 : lang === 'ar' ? 2 : 0);
const LANGN = { tr: 'Turkish', en: 'English', ar: 'Arabic (Modern Standard)' };
function prompt(lang) { return G.map(g => `- ${g[0]} => ${g[col(lang)]}`).join('\n'); }
module.exports = { G, prompt, LANGN };

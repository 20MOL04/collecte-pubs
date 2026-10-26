/**
 * La banque de mots-clés du collecteur Pub Track, PAR LANGUE (cahier 3.3 ;
 * refaite le 08/10/2026 après l'audit de qualité).
 *
 * La bibliothèque Meta ne se parcourt QUE par mot-clé, et `keyword_unordered`
 * exige TOUS les mots de la recherche dans la pub. L'audit a mesuré deux faits :
 *
 * - un nom de produit SEUL ramène le monde entier : « airpods » 5 % de pubs
 *   utiles, « gps » 9 %, « ebook » 12 %, « iphone » 22 % ;
 * - un mot de vente LOCALE ramène des vendeurs africains : « livraison
 *   gratuite » 98 %, « paiement à la livraison » 97 %, « Dakar » 89 %.
 *
 * Un produit n'est donc plus jamais cherché seul : `requetes.ts` l'accole à une
 * ancre du pays (monnaie, « livraison », capitale). Et chaque pays reçoit les
 * mots de SA langue : la banque unique en français faisait chercher « cedis » en
 * Namibie et « parfum » en arabe au Lesotho.
 *
 * Ajouter un mot ici suffit : aucun autre fichier ne liste les mots.
 */

export type LangueRecherche = 'fr' | 'en' | 'pt' | 'ar';

interface BanqueLangue {
  /** Phrases de vente déjà locales par elles-mêmes : cherchées telles quelles. */
  vente: readonly string[];
  /** Produits physiques : toujours accolés à une ancre du pays. */
  produits: readonly string[];
  /** Produits digitaux : accolés à une ancre aussi (« ebook fcfa »). */
  digital: readonly string[];
}

const FR: BanqueLangue = {
  vente: [
    'livraison gratuite', 'paiement à la livraison', 'payez à la livraison', 'livraison partout', 'livraison rapide',
    'livraison à domicile', 'stock limité', 'quantité limitée', 'nouvel arrivage', 'offre spéciale', 'prix promo',
    'commandez maintenant', 'écrivez-nous', 'contactez-nous sur whatsapp', 'lot de', '1 acheté 1 offert', 'prix de gros',
  ],
  produits: [
    // Beauté
    'crème', 'crème éclaircissante', 'lait de corps', 'savon', 'gel douche', 'sérum', 'huile', 'beurre de karité',
    'anti-tache', 'acné', 'vergetures', 'gommage', 'parfum', 'déodorant', 'perruque', 'mèches', 'cheveux',
    'pousse des cheveux', 'barbe', 'faux cils', 'maquillage', 'collagène', 'glutathion', 'dents blanches',
    // Santé
    'minceur', 'ventre plat', 'tisane', 'complément alimentaire', 'mal de dos', 'articulations', 'hémorroïdes',
    'prostate', 'diabète', 'tension', 'ulcère', 'virilité', 'fertilité', 'gélules', 'moringa',
    // Mode
    'robe', 'pagne', 'wax', 'bazin', 'boubou', 'ensemble', 'jean', 'chemise', 'sac à main', 'montre', 'bijoux',
    'lunettes', 'gaine', 'chaussures', 'baskets', 'sandales', 'abaya', 'friperie',
    // Maison
    'mixeur', 'blender', 'friteuse', 'air fryer', 'marmite', 'ustensiles', 'réfrigérateur', 'congélateur',
    'climatiseur', 'ventilateur', 'machine à laver', 'matelas', 'rideaux', 'décoration', 'canapé', 'lampe',
    'panneau solaire', 'groupe électrogène', 'aspirateur',
    // Électronique
    'téléphone', 'smartphone', 'écouteurs', 'chargeur', 'power bank', 'montre connectée', 'enceinte', 'télévision',
    'ordinateur', 'tablette', 'caméra de surveillance', 'ring light',
    // Alimentation
    'café', 'miel', 'jus', 'épices', 'gâteau', 'chocolat', 'bissap',
    // Bébé
    'couches', 'layette', 'poussette', 'jouets', 'biberon',
    // Auto
    'pièces auto', 'pneus', 'accessoires voiture', 'huile moteur', 'moto',
  ],
  digital: [
    'ebook', 'formation en ligne', 'guide pdf', 'masterclass', 'coaching', 'accès à vie', 'template', 'formation',
    'business en ligne', 'e-commerce', 'dropshipping', 'marketing digital', 'facebook ads', 'excel', 'élevage', 'agriculture',
    'fabrication de savon', 'pâtisserie',
  ],
};

const EN: BanqueLangue = {
  vente: [
    'free delivery', 'pay on delivery', 'cash on delivery', 'order now', 'limited stock', 'whatsapp to order',
    'dm to order', 'delivery nationwide', 'same day delivery', 'now available', 'wholesale price',
  ],
  produits: [
    'body cream', 'skincare', 'soap', 'serum', 'shea butter', 'dark spots', 'acne', 'stretch marks', 'perfume', 'wig',
    'hair growth', 'beard oil', 'lashes', 'makeup', 'collagen', 'teeth whitening', 'weight loss', 'flat tummy',
    'herbal tea', 'supplement', 'back pain', 'joint pain', 'pile', 'prostate', 'diabetes', 'blood pressure', 'ulcer',
    'dress', 'ankara', 'shirt', 'jeans', 'handbag', 'watch', 'jewelry', 'sunglasses', 'shapewear', 'shoes', 'sneakers',
    'slippers', 'blender', 'air fryer', 'pot', 'kitchen', 'fridge', 'freezer', 'fan', 'mattress', 'curtains',
    'solar panel', 'generator', 'inverter', 'phone', 'earbuds', 'charger', 'power bank', 'smart watch', 'speaker',
    'laptop', 'tablet', 'cctv camera', 'ring light', 'coffee', 'honey', 'juice', 'spices', 'diapers', 'baby clothes',
    'toys', 'car accessories', 'tyres', 'engine oil',
  ],
  digital: ['ebook', 'online course', 'pdf guide', 'masterclass', 'coaching', 'training', 'template', 'selar', 'digital marketing', 'forex'],
};

const PT: BanqueLangue = {
  vente: ['entrega grátis', 'pagamento na entrega', 'encomende já', 'stock limitado', 'entregamos', 'disponível'],
  produits: [
    'creme', 'sabonete', 'sérum', 'perfume', 'peruca', 'cabelo', 'emagrecer', 'chá', 'suplemento', 'dor nas costas',
    'vestido', 'roupa', 'sapatos', 'bolsa', 'relógio', 'liquidificador', 'fritadeira', 'geleira', 'ventoinha',
    'colchão', 'painel solar', 'gerador', 'telemóvel', 'auriculares', 'carregador', 'fraldas', 'brinquedos', 'peças auto',
  ],
  digital: ['ebook', 'curso online', 'formação', 'guia pdf'],
};

const AR: BanqueLangue = {
  vente: ['الدفع عند الاستلام', 'توصيل مجاني', 'اطلب الآن', 'التوصيل لجميع المدن', 'عرض خاص', 'كمية محدودة'],
  produits: [
    'كريم', 'صابون', 'سيروم', 'عطر', 'شعر', 'تخسيس', 'أعشاب', 'مكمل غذائي', 'آلام الظهر', 'فستان', 'ملابس', 'أحذية',
    'حقيبة', 'ساعة', 'خلاط', 'قلاية', 'ثلاجة', 'مكيف', 'هاتف', 'سماعات', 'شاحن', 'حفاضات', 'ألعاب', 'قطع غيار',
    'إكسسوارات السيارة',
  ],
  digital: ['دورة', 'كتاب إلكتروني', 'تدريب'],
};

export const BANQUES: Record<LangueRecherche, BanqueLangue> = { fr: FR, en: EN, pt: PT, ar: AR };

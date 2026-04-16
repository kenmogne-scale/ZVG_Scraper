export const STATES = [
  { code: "bw", name: "Baden-Wuerttemberg" },
  { code: "by", name: "Bayern" },
  { code: "be", name: "Berlin" },
  { code: "br", name: "Brandenburg" },
  { code: "hb", name: "Bremen" },
  { code: "hh", name: "Hamburg" },
  { code: "he", name: "Hessen" },
  { code: "mv", name: "Mecklenburg-Vorpommern" },
  { code: "ni", name: "Niedersachsen" },
  { code: "nw", name: "Nordrhein-Westfalen" },
  { code: "rp", name: "Rheinland-Pfalz" },
  { code: "sl", name: "Saarland" },
  { code: "sn", name: "Sachsen" },
  { code: "st", name: "Sachsen-Anhalt" },
  { code: "sh", name: "Schleswig-Holstein" },
  { code: "th", name: "Thueringen" }
];

export const ALL_OBJECT_TYPES = {
  "1": "Reihenhaus",
  "2": "Doppelhaushälfte",
  "3": "Einfamilienhaus",
  "19": "Zweifamilienhaus",
  "4": "Mehrfamilienhaus",
  "5": "Eigentumswohnung (1 bis 2 Zimmer)",
  "6": "Eigentumswohnung (3 bis 4 Zimmer)",
  "7": "Eigentumswohnung (ab 5 Zimmer)",
  "8": "Gewerbeeinheit (z.B. Laden, Büro)",
  "13": "Wohn-/Geschäftshaus",
  "9": "Garage",
  "10": "Kfz-Stellplatz",
  "11": "Kfz-Stellplatz (Tiefgarage)",
  "12": "sonstiges Teileigentum (z.B. Keller, Hobbyraum)",
  "14": "gewerblich genutztes Grundstück",
  "15": "Baugrundstück",
  "16": "unbebautes Grundstück",
  "17": "land- und forstwirtschaftlich genutztes Grundstück",
  "18": "Sonstiges"
};

export const ALL_AUCTION_TYPES = {
  "": "Alle Verfahrensarten",
  "-1": "Zwangsversteigerung zum Zwecke der Aufhebung der Gemeinschaft",
  "0": "Versteigerung im Wege der Zwangsvollstreckung",
  "1": "Zwangsversteigerung auf Antrag des Insolvenzverwalters",
  "2": "Zwangsversteigerung auf Antrag des Erben",
  "3": "Zwangsversteigerung von Schiffen, Schiffsbauwerken und Binnenschiffen",
  "6": "Zwangsversteigerung von Seekabeln",
  "4": "Zwangsversteigerung von Luftfahrzeugen",
  "5": "Zwangsversteigerung zum Zwecke der Entziehung des Wohnungseigentums",
  "7": "Aufgebotsverfahren",
  "8": "Sonstiges"
};

export const BASE_URL = "https://www.zvg-portal.de/index.php";

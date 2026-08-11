// Curated currency list for the base-currency / extra-currency <select>
// dropdowns (CreateTripDialog, CurrenciesSection) — code + Traditional
// Chinese display name, shown together as one option ("USD 美元") instead of
// separate code/name text inputs. No external API call needed for names;
// live *rates* still come from GET /api/currencies/rates.
export interface CurrencyOption {
  code: string;
  name: string;
}

export const CURATED_CURRENCIES: CurrencyOption[] = [
  { code: "TWD", name: "新台幣" },
  { code: "USD", name: "美元" },
  { code: "JPY", name: "日圓" },
  { code: "EUR", name: "歐元" },
  { code: "GBP", name: "英鎊" },
  { code: "HKD", name: "港幣" },
  { code: "CNY", name: "人民幣" },
  { code: "KRW", name: "韓元" },
  { code: "THB", name: "泰銖" },
  { code: "SGD", name: "新加坡幣" },
  { code: "MYR", name: "馬來西亞令吉" },
  { code: "IDR", name: "印尼盾" },
  { code: "VND", name: "越南盾" },
  { code: "PHP", name: "菲律賓披索" },
  { code: "AUD", name: "澳幣" },
  { code: "CAD", name: "加拿大幣" },
  { code: "CHF", name: "瑞士法郎" },
  { code: "NZD", name: "紐西蘭幣" },
  { code: "INR", name: "印度盧比" },
  { code: "MOP", name: "澳門幣" },
  { code: "LAK", name: "寮國基普" },
  { code: "MMK", name: "緬甸元" },
  { code: "KHR", name: "柬埔寨瑞爾" },
  { code: "TRY", name: "土耳其里拉" },
  { code: "AED", name: "阿聯酋迪拉姆" },
  { code: "RUB", name: "俄羅斯盧布" },
  { code: "SEK", name: "瑞典克朗" },
  { code: "NOK", name: "挪威克朗" },
  { code: "DKK", name: "丹麥克朗" },
  { code: "ZAR", name: "南非蘭特" },
];

export function formatCurrencyOption(c: CurrencyOption): string {
  return `${c.code} ${c.name}`;
}

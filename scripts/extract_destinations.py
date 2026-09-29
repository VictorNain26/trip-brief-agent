import json
import urllib.request

CLDR_VERSION = "48.2.2"
BASE = f"https://raw.githubusercontent.com/unicode-org/cldr-json/{CLDR_VERSION}/cldr-json"
NAMES = f"{BASE}/cldr-localenames-full/main/fr/territories.json"
CODES = f"{BASE}/cldr-core/supplemental/codeMappings.json"


def fetch(url):
    with urllib.request.urlopen(url) as response:
        return json.load(response)


names = fetch(NAMES)["main"]["fr"]["localeDisplayNames"]["territories"]
codes = fetch(CODES)["supplemental"]["codeMappings"]

# ISO 3166-1 numeric codes stop at 899; CLDR puts its own groupings (EU, ZZ, XK…) at 900 and above.
countries = {
    code: names[code]
    for code, mapping in codes.items()
    if len(code) == 2 and code in names and int(mapping.get("_numeric", "999")) < 900
}

payload = {
    "source": f"Unicode CLDR {CLDR_VERSION}, ISO 3166-1 codes with French names",
    "destinations": [{"id": code, "label": label} for code, label in sorted(countries.items())],
}
with open("data/destinations.json", "w", encoding="utf-8") as output:
    json.dump(payload, output, ensure_ascii=False, indent=2)
    output.write("\n")
print(len(countries))

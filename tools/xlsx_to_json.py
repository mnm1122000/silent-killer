# Converts Silent_Killer_Crime_Scenarios.xlsx -> assets/scenarios.json (stdlib only)
import zipfile, re, html, json, sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
z = zipfile.ZipFile(os.path.join(root, 'Silent_Killer_Crime_Scenarios.xlsx'))
x = z.read('xl/worksheets/sheet1.xml').decode('utf8')
rows = []
for row in re.findall(r'<row[^>]*>(.*?)</row>', x, re.S):
    cells = []
    for attrs, inner in re.findall(r'<c ([^>]*?)(?:/>|>(.*?)</c>)', row, re.S):
        t = ''.join(re.findall(r'<t[^>]*>(.*?)</t>', inner or '', re.S)) or ''.join(re.findall(r'<v>(.*?)</v>', inner or ''))
        cells.append(html.unescape(t).strip())
    rows.append(cells)
out = []
for r in rows[1:]:
    if len(r) >= 5 and r[0]:
        out.append({"id": r[0], "title": r[1], "location": r[2], "cause": r[3], "text": r[4]})
json.dump(out, open(os.path.join(root, 'assets', 'scenarios.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print(len(out), 'scenarios')

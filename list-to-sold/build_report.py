import csv
from datetime import date
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
D=date.fromisoformat
HR='https://www.highrises.com/realestateandhomes-detail/'
import sys,os
HERE=os.path.dirname(os.path.abspath(__file__))
YEAR=int(sys.argv[1]) if len(sys.argv)>1 else date.today().year
END=D(sys.argv[2]) if len(sys.argv)>2 else date.today()
OUT=sys.argv[3] if len(sys.argv)>3 else f'Water_Oak_List_to_Sold_{YEAR}.xlsx'
rows=[]
for r in csv.DictReader(open(os.path.join(HERE,'master_sales.csv'))):
    mls=r['list_source']=='MyStateMLS'
    lsrc='MyStateMLS history (last list)' if mls else 'Foxfire listing page (not confirmed as last)'
    url=r['highrises_url']+('' if mls or not r['foxfire_id'] else '  +  foxfiremanufactured.com/HomedetailCustom.asp?id='+r['foxfire_id'])
    note=r['note'] if mls else ('List date & price from Foxfire; sold from MyStateMLS. '+r['note']).strip()
    rows.append([r['address'],D(r['list_date']),int(r['orig_list']) if r['orig_list'] else None,int(r['list_used']),lsrc,int(r['sold_price']),D(r['sold_date']),r['broker'],url,note])
rows=[r for r in rows if date(YEAR,1,1)<=r[6]<=END]
rows.sort(key=lambda r:r[6])
F=lambda b=False,c='000000',s=12:Font(name='Arial',size=s,bold=b,color=c)
NAVY='1F2A44';GOLD='C9A24A'
wb=Workbook();ws=wb.active;ws.title=f'List-to-Sold {YEAR}'
ws['A1']=f'Water Oak Country Club Estates — List-to-Sold, Jan 1 – {END.strftime("%b %-d")}, {YEAR}';ws['A1'].font=F(True,NAVY,16)
ws['A2']='Paired sales only: each row has a list price, a sold price and a sold date. Built '+date.today().strftime('%m/%d/%Y')+' from master_sales.csv.';ws['A2'].font=F(False,'555555',12)
hdr=['Address','List Date','Original List','List Price Used','List Price Source','Sold Price','Sold Date','DOM','% vs List Used','% vs Original','Listed In','Broker','Source / URL','Notes']
H=14;start=H+1
ws.append([]) if False else None
for i,h in enumerate(hdr,1):
    c=ws.cell(H,i,h);c.font=F(True,'FFFFFF');c.fill=PatternFill('solid',fgColor=NAVY);c.alignment=Alignment(wrap_text=True,vertical='center')
for k,r in enumerate(rows):
    n=start+k
    a,ld,orig,last,lsrc,sold,sd,brk,url,note=r
    vals={1:a,2:ld,3:orig,4:last,5:lsrc,6:sold,7:sd,12:brk,13:url,14:note or None}
    for col,v in vals.items(): ws.cell(n,col,v)
    ws.cell(n,8,f'=G{n}-B{n}')
    ws.cell(n,9,f'=(F{n}-D{n})/D{n}')
    ws.cell(n,10,f'=IF(C{n}="","",(F{n}-C{n})/C{n})')
    ws.cell(n,11,f'=IF(YEAR(B{n})=2026,"2026","Before 2026")')
    for col in range(1,15): ws.cell(n,col).font=F()
    for col in (3,4,6): ws.cell(n,col).number_format='$#,##0'
    for col in (2,7): ws.cell(n,col).number_format='m/d/yyyy'
    for col in (9,10): ws.cell(n,col).number_format='0.0%'
    if k%2: 
        for col in range(1,15): ws.cell(n,col).fill=PatternFill('solid',fgColor='F3F1EA')
end=start+len(rows)-1
R=f'{start}:{end}'
rng=lambda c:f'{c}{start}:{c}{end}'
summ=[('Paired sales',f'=COUNTA({rng("A")})','0'),
('  Fully MLS-verified (MLS list + MLS sale)',f'=COUNTIF({rng("E")},"MyStateMLS*")','0'),
('  Foxfire list price + MLS sale',f'=COUNTIF({rng("E")},"Foxfire*")','0'),
('Average % vs list price used',f'=AVERAGE({rng("I")})','0.0%'),
('Median % vs list price used',f'=MEDIAN({rng("I")})','0.0%'),
('Average days on market',f'=AVERAGE({rng("H")})','0'),
('Median days on market',f'=MEDIAN({rng("H")})','0'),
('Median sold price',f'=MEDIAN({rng("F")})','$#,##0'),
('Listed in 2026 and sold — count / median % / median DOM',f'=COUNTIF({rng("K")},"2026")&" homes  |  "&TEXT(SUMPRODUCT(({rng("K")}="2026")*1)*0+MEDIAN(IF({rng("K")}="2026",{rng("I")})),"0.0%")&"  |  "&MEDIAN(IF({rng("K")}="2026",{rng("H")}))&" days"',None),
('Listed before 2026, sold in 2026 — count / median % / median DOM',f'=COUNTIF({rng("K")},"Before 2026")&" homes  |  "&TEXT(MEDIAN(IF({rng("K")}="Before 2026",{rng("I")})),"0.0%")&"  |  "&MEDIAN(IF({rng("K")}="Before 2026",{rng("H")}))&" days"',None)]
from openpyxl.worksheet.formula import ArrayFormula
for i,(lab,f,fmt) in enumerate(summ):
    r=4+i
    ws.cell(r,1,lab).font=F(i in (0,3,4,5,6,7))
    c=ws.cell(r,4)
    if 'IF(' in f and 'MEDIAN(IF' in f: c.value=ArrayFormula(f'D{r}',f)
    else: c.value=f
    c.font=F(True,NAVY,13)
    if fmt: c.number_format=fmt
widths=[26,12,13,14,30,13,12,8,11,11,13,18,62,48]
for i,w in enumerate(widths): ws.column_dimensions[chr(65+i)].width=w
ws.freeze_panes=f'B{start}'
# Gaps
g=wb.create_sheet('Gaps & Exclusions')
g['A1']='Gaps & exclusions — not in any average';g['A1'].font=F(True,NAVY,16)
gh=['Address','What we have','Why it is out','Source']
LBL={'no_verified_list':'Sold, list price not verifiable','source_conflict':'Source conflict','stamp_no_sale':'Foxfire SOLD stamp, no sale found','pending':'Pending — dropped','sold_2025':'Sold before this year — outside window','not_covered':'Not covered','note':'Notes'}
G=list(csv.DictReader(open(os.path.join(HERE,'gaps.csv'))))
gaps=[]
for cat in LBL:
    in_year=lambda x: not x['sold_date'] or x['sold_date'][:4]==str(YEAR)
    if cat=='sold_2025': sub=[x for x in G if not in_year(x) and x['category'] not in ('not_covered','note')]
    else: sub=[x for x in G if x['category']==cat and in_year(x)]
    if not sub: continue
    gaps.append((LBL[cat],'','',''))
    for gg in sub:
        have=gg['what_we_have']+(f" — sold {gg['sold_date']} ${int(gg['sold_price']):,}" if gg['sold_price'] else '')
        gaps.append((gg['address'],have,gg['reason'],gg['source']))
for i,h in enumerate(gh,1):
    c=g.cell(3,i,h);c.font=F(True,'FFFFFF');c.fill=PatternFill('solid',fgColor=NAVY)
for k,row in enumerate(gaps):
    for i,v in enumerate(row,1):
        c=g.cell(4+k,i,v or None);c.font=F(row[1]=='' );c.alignment=Alignment(wrap_text=True,vertical='top')
    if row[1]=='': g.cell(4+k,1).fill=PatternFill('solid',fgColor='EFE6CC')
for col,w in zip('ABCD',[44,46,52,34]): g.column_dimensions[col].width=w
n=ws.max_row+2
notes=['Method: (1) RE/MAX Foxfire sold/archive pages for addresses; (2) every address looked up on Highrises.com (Realtor.com data) for MyStateMLS list and sale history; (3) Highrises Water Oaks Country Club Estates recently-sold list.',
'List Price Used: last list price from MyStateMLS history when shown. When MLS shows the sale but no 2026 listing, the Foxfire listing price is used and labeled — Foxfire sometimes shows an older asking price, so it is not confirmed as the final list.',
'DOM = sold date minus list date of the listing that sold (remove/relist inside the same run counted as one run).',
'% vs List Used compares each home\'s own sold price to its own list price. List medians are never compared to sold medians.']
for i,t in enumerate(notes): ws.cell(n+i,1,t).font=F(False,'444444',11)
wb.save(OUT)
print(len(rows))

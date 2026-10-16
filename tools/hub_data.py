#!/usr/bin/env python3
"""Validate, merge and report on multi-hub Airlines Manager CSV exports. Stdlib only."""
import argparse,csv,json,re,sys
from collections import Counter,defaultdict
from pathlib import Path

ROUTE_REQUIRED={'hub','airport_code','ownership_status','route_id','distance_km','category'}
PRICE_REQUIRED={'hub','airport_code','route_id','status','current_price_economy','current_demand_economy','current_price_cargo','current_demand_cargo'}
HUB_PATTERN=re.compile(r'^[A-Z0-9]{3,5}$')

def read_csv(path,required):
    with open(path,encoding='utf-8-sig',newline='') as f:
        reader=csv.DictReader(f)
        if not reader.fieldnames: raise ValueError(f'{path}: missing CSV header')
        headers=[x.strip().lstrip('\ufeff') for x in reader.fieldnames]
        if len(set(headers))!=len(headers): raise ValueError(f'{path}: duplicate column headers')
        missing=required-set(headers)
        if missing: raise ValueError(f'{path}: missing columns: {", ".join(sorted(missing))}')
        records=[]
        for line,row in enumerate(reader,2):
            if None in row: raise ValueError(f'{path}: extra columns on record {line}')
            item={k.strip().lstrip('\ufeff'):(v or '').strip() for k,v in row.items()}
            item['hub']=item['hub'].upper();item['airport_code']=item['airport_code'].upper()
            if not HUB_PATTERN.fullmatch(item['hub']): raise ValueError(f'{path}: invalid hub at record {line}: {item["hub"]!r}')
            records.append(item)
    return headers,records

def positive_number(value,strict=False):
    try:
        n=float(str(value).replace(',',''))
        return n>=0 and n!=float('inf') and (n>0 if strict else True)
    except (ValueError,TypeError):return False

def inspect(routes,pricing):
    errors=[];warnings=[];owned={};prices={};hub_stats=defaultdict(Counter)
    seen_dest=set()
    for i,r in enumerate(routes,2):
        hub=r['hub'];hub_stats[hub]['routes']+=1
        dest=r['airport_code'];own=r['ownership_status'].lower()
        if not dest: errors.append(f'Routes row {i}: missing destination')
        if (hub,dest) in seen_dest: errors.append(f'Routes row {i}: duplicate hub/destination {hub}/{dest}')
        seen_dest.add((hub,dest))
        if not positive_number(r['distance_km'],True): errors.append(f'Routes row {i}: invalid distance for {hub}/{dest}')
        try: cat=int(r['category']);assert 1<=cat<=10
        except (ValueError,AssertionError): errors.append(f'Routes row {i}: invalid category for {hub}/{dest}')
        if own not in ('owned','unowned'): errors.append(f'Routes row {i}: invalid ownership {hub}/{dest}: {own}')
        if own=='owned':
            hub_stats[hub]['owned']+=1
            key=(hub,r['route_id'])
            if not r['route_id']: errors.append(f'Routes row {i}: owned route missing ID {hub}/{dest}')
            elif key in owned: errors.append(f'Routes row {i}: duplicate owned route ID {key}')
            owned[key]=r
    for i,p in enumerate(pricing,2):
        hub=p['hub'];hub_stats[hub]['pricing']+=1
        key=(hub,p['route_id'])
        if not p['route_id']: errors.append(f'Pricing row {i}: missing route ID for {hub}/{p["airport_code"]}')
        if key in prices: errors.append(f'Pricing row {i}: duplicate route ID {key}')
        prices[key]=p
        route=owned.get(key)
        if route is None: errors.append(f'Pricing row {i}: no matching owned route {hub}/{p["route_id"]}')
        elif route['airport_code']!=p['airport_code']: errors.append(f'Pricing row {i}: destination mismatch {hub}/{p["route_id"]}: {route["airport_code"]} vs {p["airport_code"]}')
        if p['status'].lower()=='ok':
            hub_stats[hub]['pricing_ok']+=1
            for field in ('current_price_economy','current_demand_economy','current_price_cargo','current_demand_cargo'):
                if not positive_number(p[field]): errors.append(f'Pricing row {i}: invalid {field} for {hub}/{p["route_id"]}')
        else: warnings.append(f'Pricing {hub}/{p["route_id"]}: status {p["status"]!r}; not usable')
    for key,r in owned.items():
        if key not in prices: warnings.append(f'Owned route {key[0]}/{key[1]} ({r["airport_code"]}) has no pricing')
    for hub in hub_stats:
        hub_stats[hub]['missing_pricing']=sum(1 for key in owned if key[0]==hub and key not in prices)
        hub_stats[hub]['usable_pricing']=sum(1 for key,p in prices.items() if key[0]==hub and key in owned and p['status'].lower()=='ok')
    return {'errors':errors,'warnings':warnings,'hubs':{h:dict(sorted(c.items())) for h,c in sorted(hub_stats.items())},'totals':{'routes':len(routes),'pricing':len(pricing),'owned':len(owned)}}

def write_csv(path,headers,rows):
    path.parent.mkdir(parents=True,exist_ok=True)
    with open(path,'w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=headers,extrasaction='ignore');w.writeheader();w.writerows(rows)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    sub=p.add_subparsers(dest='command',required=True)
    v=sub.add_parser('validate',help='Check existing combined CSVs');v.add_argument('--routes',required=True);v.add_argument('--pricing',required=True);v.add_argument('--report')
    m=sub.add_parser('merge',help='Replace a single hub atomically in new output CSVs')
    for name in ('base-routes','base-pricing','hub-routes','hub-pricing','out-dir'):m.add_argument('--'+name,required=True)
    m.add_argument('--hub',required=True);m.add_argument('--scenario',choices=['new','promoted'],required=True);m.add_argument('--allow-empty-owned',action='store_true');m.add_argument('--allow-missing-pricing',action='store_true')
    args=p.parse_args()
    try:
        if args.command=='validate':
            _,r=read_csv(args.routes,ROUTE_REQUIRED);_,q=read_csv(args.pricing,PRICE_REQUIRED)
            report=inspect(r,q)
            if args.report:Path(args.report).write_text(json.dumps(report,indent=2)+'\n')
        else:
            hub=args.hub.strip().upper()
            if not HUB_PATTERN.fullmatch(hub):raise ValueError('Invalid --hub code')
            rh,base_r=read_csv(args.base_routes,ROUTE_REQUIRED);ph,base_p=read_csv(args.base_pricing,PRICE_REQUIRED)
            nrh,new_r=read_csv(args.hub_routes,ROUTE_REQUIRED);nph,new_p=read_csv(args.hub_pricing,PRICE_REQUIRED)
            if not new_r:raise ValueError('Hub route export is empty')
            if any(x['hub']!=hub for x in new_r+new_p):raise ValueError('Hub exports contain another hub; refusing to merge')
            if args.scenario=='new' and any(x['hub']==hub for x in base_r+base_p):raise ValueError('Hub already exists in combined data; use --scenario promoted to replace its snapshot')
            if not args.allow_empty_owned and not any(x['ownership_status'].lower()=='owned' for x in new_r):raise ValueError('No owned routes. Use --allow-empty-owned to stage an unpurchased new hub (not selectable in optimiser).')
            if not args.allow_missing_pricing and any(x['ownership_status'].lower()=='owned' for x in new_r) and not new_p:raise ValueError('Owned routes but no pricing. Use --allow-missing-pricing to stage incomplete data.')
            if set(nrh)!=set(rh) or set(nph)!=set(ph):raise ValueError('Input columns do not match the combined schema. Export/convert to the exact headers first.')
            r=[x for x in base_r if x['hub']!=hub]+new_r
            q=[x for x in base_p if x['hub']!=hub]+new_p
            report=inspect(r,q)
            if report['errors']:raise ValueError('Validation failed; no files written. First errors:\n  '+'\n  '.join(report['errors'][:15]))
            out=Path(args.out_dir)
            write_csv(out/'routes.csv',rh,r);write_csv(out/'pricing.csv',ph,q)
            (out/'validation_report.json').write_text(json.dumps(report,indent=2)+'\n')
            print(f'Hub {hub} ({args.scenario}) merged to {out}. Original CSVs unchanged.')
        print(json.dumps({'totals':report['totals'],'hubs':report['hubs'],'errors':len(report['errors']),'warnings':len(report['warnings'])},indent=2))
        if report['errors']:
            print('First errors:\n'+'\n'.join(report['errors'][:20]),file=sys.stderr)
            return 1
        return 0
    except (ValueError,OSError) as exc:
        print(f'ERROR: {exc}',file=sys.stderr);return 2

if __name__=='__main__':sys.exit(main())

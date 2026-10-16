import csv, tempfile, unittest
from pathlib import Path
from hub_data import read_csv,inspect,write_csv,ROUTE_REQUIRED,PRICE_REQUIRED
ROOT=Path(__file__).resolve().parents[1]
class HubDataTests(unittest.TestCase):
 def setUp(self):
  self.rh,self.routes=read_csv(ROOT/'data/routes.csv',ROUTE_REQUIRED)
  self.ph,self.pricing=read_csv(ROOT/'data/pricing.csv',PRICE_REQUIRED)
 def test_baseline(self):
  result=inspect(self.routes,self.pricing)
  self.assertEqual(result['errors'],[])
  self.assertEqual(result['totals']['routes'],4149)
 def test_promoted_replacement_no_duplicates(self):
  r=[x for x in self.routes if x['hub']!='BOM']+[x for x in self.routes if x['hub']=='BOM']
  p=[x for x in self.pricing if x['hub']!='BOM']+[x for x in self.pricing if x['hub']=='BOM']
  self.assertEqual(inspect(r,p)['errors'],[])
 def test_duplicate_rejected(self):
  r=self.routes+[self.routes[0].copy()]
  self.assertTrue(any('duplicate hub/destination' in x for x in inspect(r,self.pricing)['errors']))
 def test_new_hub(self):
  owned=next(x for x in self.routes if x['hub']=='BOM' and x['ownership_status']=='owned')
  price=next(x for x in self.pricing if x['hub']=='BOM' and x['route_id']==owned['route_id'])
  nr={**owned,'hub':'SYD','route_id':'SYD-TEST-1','airport_code':'ZZZ'}
  np={**price,'hub':'SYD','route_id':'SYD-TEST-1','airport_code':'ZZZ'}
  self.assertEqual(inspect(self.routes+[nr],self.pricing+[np])['errors'],[])
if __name__=='__main__':unittest.main()

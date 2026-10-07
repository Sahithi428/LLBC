import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app import polygon_area, polygon_perimeter, build_layout, make_building

def test_square():
    pts=[{"x":0,"y":0},{"x":10,"y":0},{"x":10,"y":10},{"x":0,"y":10}]
    assert polygon_area(pts)==100
    assert round(polygon_perimeter(pts),2)==40

def test_layout():
    l=build_layout(6000,6)
    assert len(l["plots"])==6
    assert l["common_park"]["area_sqft"]>0
    assert l["common_parking"]["area_sqft"]>0

def test_building():
    b=make_building({"plot":{"plot_no":1},"building_type":"Residential","floors":3,"width_ft":24,"length_ft":30,"setbacks":{}})
    assert b["floors"]==3
    assert b["built_up_sqft"]==2160
    assert len(b["floor_data"])==3

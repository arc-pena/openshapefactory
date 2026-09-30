# stipimg.py pdf page box origin xsign : stippled rectangles found in the rendered page (dot density), model feet
import pymupdf, sys, numpy as np
pdf,pg,box,org,sx=sys.argv[1],int(sys.argv[2]),[float(v) for v in sys.argv[3].split(',')],[float(v) for v in sys.argv[4].split(',')],float(sys.argv[5])
p=pymupdf.open(pdf)[pg-1]; k=72/25.4; H=p.rect.height; dpi=300
pm=p.get_pixmap(dpi=dpi, clip=pymupdf.Rect(box[0]*k,H-box[3]*k,box[2]*k,H-box[1]*k), colorspace=pymupdf.csGRAY)
a=np.frombuffer(pm.samples,dtype=np.uint8).reshape(pm.height,pm.width)<128
# remove long vertical/horizontal lines: a dark pixel is a line pixel if its column run is long
from scipy import ndimage
vert=ndimage.binary_opening(a, structure=np.ones((25,1))); hor=ndimage.binary_opening(a, structure=np.ones((1,25)))
dots=a & ~vert & ~hor
mm=25.4/dpi
cell=int(1.0/mm)   # 1 mm cells
h,w=dots.shape; H2,W2=h//cell,w//cell
d=dots[:H2*cell,:W2*cell].reshape(H2,cell,W2,cell).sum(axis=(1,3))/(cell*cell)
m=d>0.04
lab,n=ndimage.label(ndimage.binary_closing(m, structure=np.ones((3,3))))
F=lambda v: v*96/304.8
for i in range(1,n+1):
  ys,xs=np.where(lab==i)
  if len(xs)<12: continue
  x0=box[0]+xs.min()*cell*mm; x1=box[0]+(xs.max()+1)*cell*mm; y1=box[3]-ys.min()*cell*mm; y0=box[3]-(ys.max()+1)*cell*mm
  X=sorted([sx*F(x0-org[0]),sx*F(x1-org[0])]); print(round(X[0],1),round(X[1],1),'z',round(F(y0-org[1]),1),round(F(y1-org[1]),1))

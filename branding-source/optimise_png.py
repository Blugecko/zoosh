import zlib,struct,sys
def paeth(a,b,c):
    p=a+b-c;pa=abs(p-a);pb=abs(p-b);pc=abs(p-c)
    return a if pa<=pb and pa<=pc else (b if pb<=pc else c)
def unfilter(raw,w,h,bpp):
    st=w*bpp;out=bytearray();prev=bytearray(st);p=0
    for _ in range(h):
        f=raw[p];row=bytearray(raw[p+1:p+1+st]);p+=1+st
        for i in range(st):
            a=row[i-bpp] if i>=bpp else 0;b=prev[i];c=prev[i-bpp] if i>=bpp else 0
            x=row[i]
            if f==1:x+=a
            elif f==2:x+=b
            elif f==3:x+=(a+b)//2
            elif f==4:x+=paeth(a,b,c)
            row[i]=x&255
        out+=row;prev=row
    return out
def opt(path,q):
    d=open(path,'rb').read();p=8;idat=b''
    while p<len(d):
        n,t=struct.unpack('>I4s',d[p:p+8])
        if t==b'IHDR':w,h=struct.unpack('>II',d[p+8:p+16])
        if t==b'IDAT':idat+=d[p+8:p+8+n]
        p+=12+n
    bpp=4;img=unfilter(zlib.decompress(idat),w,h,bpp);st=w*bpp
    if q>1:
        for i in range(0,len(img),4):
            if img[i+3]==0: img[i]=img[i+1]=img[i+2]=0
            else:
                for k in range(3): img[i+k]=min(255,((img[i+k]+q//2)//q)*q)
                img[i+3]=min(255,((img[i+3]+q//2)//q)*q)
    out=bytearray();prev=bytearray(st)
    for y in range(h):
        row=img[y*st:(y+1)*st];best=None
        for f in (0,1,2,4):
            r=bytearray(st)
            for i in range(st):
                a=row[i-bpp] if i>=bpp else 0;b=prev[i];c=prev[i-bpp] if i>=bpp else 0
                pr=(0,a,b,0,paeth(a,b,c))[f]
                r[i]=(row[i]-pr)&255
            s=sum(v if v<128 else 256-v for v in r)
            if best is None or s<best[0]:best=(s,f,r)
        out.append(best[1]);out+=best[2];prev=row
    z=zlib.compress(bytes(out),9)
    def ch(t,c):return struct.pack('>I',len(c))+t+c+struct.pack('>I',zlib.crc32(t+c)&0xffffffff)
    open(path,'wb').write(b'\x89PNG\r\n\x1a\n'+ch(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+ch(b'IDAT',z)+ch(b'IEND',b''))
opt(sys.argv[2],int(sys.argv[1]))

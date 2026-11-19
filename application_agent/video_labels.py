"""Burn a fixed status label into video pixels, without altering the employer page."""

LABELS={'confirmed':'EMPLOYER CONFIRMATION OBSERVED','agent':'AGENT FILLING FORM','waiting':'USER INPUT NEEDED - AGENT PAUSED',
        'manual':'YOU HAVE CONTROL - AGENT PAUSED','resuming':'RETURNING CONTROL TO AGENT',
        'submit':'READY - SUBMIT IT YOURSELF','private':'PRIVATE CHECK - VIDEO PAUSED'}
# A small fixed alphabet avoids external fonts, binaries and image dependencies.
FONT={
'A':['01110','10001','10001','11111','10001','10001','10001'],
'B':['11110','10001','10001','11110','10001','10001','11110'],
'C':['01111','10000','10000','10000','10000','10000','01111'],
'D':['11110','10001','10001','10001','10001','10001','11110'],
'E':['11111','10000','10000','11110','10000','10000','11111'],
'F':['11111','10000','10000','11110','10000','10000','10000'],
'G':['01111','10000','10000','10111','10001','10001','01111'],
'H':['10001','10001','10001','11111','10001','10001','10001'],
'I':['11111','00100','00100','00100','00100','00100','11111'],
'K':['10001','10010','10100','11000','10100','10010','10001'],
'L':['10000','10000','10000','10000','10000','10000','11111'],
'M':['10001','11011','10101','10101','10001','10001','10001'],
'N':['10001','11001','11001','10101','10011','10011','10001'],
'O':['01110','10001','10001','10001','10001','10001','01110'],
'P':['11110','10001','10001','11110','10000','10000','10000'],
'R':['11110','10001','10001','11110','10100','10010','10001'],
'S':['01111','10000','10000','01110','00001','00001','11110'],
'T':['11111','00100','00100','00100','00100','00100','00100'],
'U':['10001','10001','10001','10001','10001','10001','01110'],
'V':['10001','10001','10001','10001','10001','01010','00100'],
'Y':['10001','10001','01010','00100','00100','00100','00100'],
'-':['00000','00000','00000','11111','00000','00000','00000']}

def label_frame(frame,label):
 text=LABELS.get(label,'')
 if not text:return frame
 y=frame.height-36
 for index,plane in enumerate(frame.planes):
  data=bytearray(plane);start=y if index==0 else y//2
  for row in range(start,plane.height):
   offset=row*plane.line_size;data[offset:offset+plane.width]=bytes([28 if index==0 else 128])*plane.width
  if index==0:
   for col,char in enumerate(text):
    for row,line in enumerate(FONT.get(char,[])):
     for cell,pixel in enumerate(line):
      if pixel=='1':
       for dy in range(3):
        offset=(y+7+row*3+dy)*plane.line_size+12+col*18+cell*3
        data[offset:offset+3]=b'\xeb'*3
  plane.update(data)
 return frame

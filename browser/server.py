"""Ephemeral official-site login desktop; no persistent browser profile or host access."""
import json, os, subprocess, time, threading, shutil, urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler
import websocket
processes=[]
platform=None
started=0
lock=threading.RLock()
SITES={'bilibili':'https://passport.bilibili.com/login','youtube':'https://www.youtube.com/'}
def stop():
 global platform,started
 with lock:
  for p in reversed(processes):
   if p.poll() is None:
    p.terminate()
    try:p.wait(timeout=3)
    except subprocess.TimeoutExpired:p.kill();p.wait()
  processes.clear();platform=None;started=0
  shutil.rmtree('/tmp/profile',ignore_errors=True)
  return {'ok':True}
def launch(args):
 p=subprocess.Popen(args,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=dict(os.environ,DISPLAY=':99'))
 processes.append(p);return p
def start(which):
 global platform,started
 if which not in SITES:raise ValueError('平台无效')
 with lock:
  stop();os.makedirs('/tmp/home',exist_ok=True)
  launch(['Xvfb',':99','-screen','0','1280x800x24','-nolisten','tcp'])
  time.sleep(.5)
  launch(['x11vnc','-display',':99','-localhost','-rfbport','5900','-nopw','-forever','-shared','-quiet'])
  launch(['websockify','--web=/usr/share/novnc','6080','127.0.0.1:5900'])
  launch(['chromium','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--disable-extensions','--disable-sync','--disable-translate','--no-first-run','--no-default-browser-check','--password-store=basic','--user-data-dir=/tmp/profile','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9222','--remote-allow-origins=http://127.0.0.1:9222','--proxy-server=http://proxy:1080','--proxy-bypass-list=*.bilibili.com;*.hdslb.com','--window-size=1280,800',SITES[which]])
  platform=which;started=time.time()
  for _ in range(50):
   try:
    with urllib.request.urlopen('http://127.0.0.1:9222/json/version',timeout=1) as r:json.load(r)
    return {'ok':True,'platform':which,'expiresIn':900}
   except Exception:time.sleep(.3)
  stop();raise ValueError('浏览器启动失败，请稍后重试或导入 Cookie')
def capture():
 with lock:
  if platform is None:raise ValueError('请先启动登录浏览器')
  with urllib.request.urlopen('http://127.0.0.1:9222/json/version',timeout=3) as r:version=json.load(r)
  ws=websocket.create_connection(version['webSocketDebuggerUrl'],timeout=8,origin='http://127.0.0.1:9222')
  try:
   ws.send(json.dumps({'id':1,'method':'Storage.getCookies'}))
   while True:
    data=json.loads(ws.recv())
    if data.get('id')==1:break
   domain='bilibili.com' if platform=='bilibili' else 'youtube.com'
   cookies=[c for c in data.get('result',{}).get('cookies',[]) if c.get('domain','').lstrip('.')==domain or c.get('domain','').endswith('.'+domain)]
   return {'platform':platform,'cookies':cookies}
  finally:ws.close()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path!='/healthz':self.send_error(404);return
  self.send_response(200);self.end_headers();self.wfile.write(b'ok')
 def do_POST(self):
  try:
   size=int(self.headers.get('Content-Length','0'))
   if size>1000:raise ValueError('请求过大')
   data=json.loads(self.rfile.read(size) or '{}')
   if self.path=='/start':out=start(data.get('platform'))
   elif self.path=='/stop':out=stop()
   elif self.path=='/capture':out=capture()
   else:raise ValueError('接口不存在')
   status=200
  except Exception as e:
   out={'error':str(e) if isinstance(e,ValueError) else '浏览器操作失败，请重试'};status=400
  body=json.dumps(out).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
def watchdog():
 while True:
  time.sleep(10)
  if started and time.time()-started>900:stop()
threading.Thread(target=watchdog,daemon=True).start()
HTTPServer(('0.0.0.0',6090),Handler).serve_forever()

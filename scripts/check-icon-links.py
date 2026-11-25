import re
import urllib.request

html = urllib.request.urlopen("http://127.0.0.1:8000/", timeout=20).read().decode("utf-8")
for m in re.findall(r"<link[^>]*rel=\"[^\"]*icon[^\"]*\"[^>]*>", html):
    print(m)
title = re.search(r"<title>(.*?)</title>", html)
print("title:", title.group(1) if title else None)

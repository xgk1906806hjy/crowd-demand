import pathlib

root = pathlib.Path("/home/arzopa/apps/crowd-demand/deploy")
for p in root.glob("*.sh"):
    raw = p.read_bytes()
    fixed = raw.replace(b"\r\n", b"\n")
    if fixed != raw:
        p.write_bytes(fixed)
        print("converted", p.name)
    else:
        print("clean", p.name)

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { routerHealth } from "../src/router-health.ts";
test("router checks fail closed for missing, insecure and symlink logs without reading content", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jev-health-"));
  try {
    assert.equal((await routerHealth([],root,root)).privacy.restricted,false);
    const dir = path.join(root,"jev-claude"); await fs.mkdir(dir,{mode:0o700});
    const file = path.join(dir,"fixture.json"); await fs.writeFile(file,"PRIVATE invalid JSON",{mode:0o600});
    const good = await routerHealth([],root,root);
    assert.equal(good.privacy.restricted,true); assert.equal(good.version,null);
    assert.ok(!JSON.stringify(good).includes("PRIVATE"));
    await fs.chmod(file,0o644);
    assert.equal((await routerHealth([],root,root)).privacy.insecureFiles,1);
    await fs.symlink(file,path.join(dir,"link.json"));
    assert.equal((await routerHealth([],root,root)).privacy.skippedFiles,1);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

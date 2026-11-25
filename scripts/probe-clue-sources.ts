import { CsdnClueSource } from "../src/infrastructure/clue/csdn";
import { WeixinClueSource } from "../src/infrastructure/clue/weixin";
import { JuejinClueSource } from "../src/infrastructure/clue/juejin";
import { looksLikeDemand } from "../src/domain/clue/keywords";

async function main() {
  const sources = [new CsdnClueSource(15000), new WeixinClueSource(15000), new JuejinClueSource(15000)];
  for (const source of sources) {
    try {
      const items = await source.fetch();
      const kept = items.filter((i) => looksLikeDemand(`${i.title} ${i.excerpt}`));
      console.log(`\n[${source.key}] 抓取 ${items.length} 条，需求信号通过 ${kept.length} 条`);
      for (const item of kept.slice(0, 8)) {
        console.log(`  - ${item.title.slice(0, 60)}`);
      }
    } catch (e) {
      console.log(`[${source.key}] 失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main();

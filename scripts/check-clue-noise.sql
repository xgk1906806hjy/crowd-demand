select
  count(*) as total,
  count(*) filter (where title like '%推荐%') as rec,
  count(*) filter (where title like '%盘点%' or title like '%榜单%' or title like '%合集%' or title like '%清单%') as list_like,
  count(*) filter (where title like '%教程%' or title like '%指南%' or title like '%详解%') as tutorial_like,
  count(*) filter (where title like '%发布%' or title like '%出炉%' or title like '%上线%') as release_like
from "DemandClue";

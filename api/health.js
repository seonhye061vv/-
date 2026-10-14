// 설정 점검: 값은 보여 주지 않고 준비 여부만 알려 준다
import { handler, send } from "../lib/http.js";
import { storeKind, getJSON } from "../lib/store.js";

export default handler(async (req, res) => {
  const kind = storeKind();
  let store = kind === "none" ? "없음" : "확인 중";
  if (kind !== "none") { try { await getJSON("rb:state", null); store = "정상"; } catch (e) { store = "연결 실패"; } }
  send(res, 200, {
    저장소: store, 저장소방식: kind,
    ADMIN_PASSWORD: Boolean(process.env.ADMIN_PASSWORD), SESSION_SECRET: Boolean(process.env.SESSION_SECRET), SYNC_KEY: Boolean(process.env.SYNC_KEY),
  });
});

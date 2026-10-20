import { App } from "../src/App";
import { getChatGPTUser } from "./chatgpt-auth";
import { registerUser } from "./server/access";
export const dynamic = "force-dynamic";
export default async function Page() {
  const user = await getChatGPTUser();
  if (!user) return <main className="state-shell"><section className="state-panel"><h1>Local access only</h1><p>Start this workspace with npm run dev and open its loopback URL. Hosted access requires a separately configured trusted authentication adapter.</p></section></main>;
  const access = await registerUser(user);
  if (!access) return <main><h1>Local owner unavailable</h1></main>;
  return <App user={{ email: user.email, displayName: user.displayName }} isOwner={access.isOwner} />;
}

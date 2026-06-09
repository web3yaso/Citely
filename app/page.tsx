import { Masthead } from "@/components/home/Masthead";
import { HomeTabs } from "@/components/home/HomeTabs";
import { Footer } from "@/components/home/Footer";
import { listReaderCatalog } from "@/lib/reports";
import { listLeaderboard, getWriterStats } from "@/lib/leaderboard";

// Reads the attestation index per request → don't statically cache (also keeps
// the Phase-5 leaderboard live, and surfaces freshly published articles).
export const dynamic = "force-dynamic";

export default async function Home() {
  // 收录文章 = every published report, newest first (incl. the /publish import
  // example once it has been published — matches the /reports catalog).
  const readerArticles = await listReaderCatalog();
  const leaderboard = await listLeaderboard();
  const writerStats = await getWriterStats();
  return (
    <>
      <Masthead />
      <main>
        <HomeTabs readerArticles={readerArticles} leaderboard={leaderboard} writerStats={writerStats} />
      </main>
      <Footer />
    </>
  );
}

import { notFound } from "next/navigation";
import ReportRenderer from "@/components/final-mile/report/ReportRenderer";
import { getSharedAnalysis } from "@/lib/actions/analysis-share-tokens";
import type { AnalyzerReport } from "@/lib/analyzer/report-types";

interface SharePageProps {
  params: { token: string };
}

export const dynamic = "force-dynamic";

export default async function SharePage({ params }: SharePageProps) {
  const shared = await getSharedAnalysis(params.token);
  if (!shared) notFound();

  const report = shared.analysis.report_json as AnalyzerReport;

  return (
    <>
      <ShareHeader tenantName={shared.tenant_name} createdAt={shared.analysis.created_at} />
      <ReportRenderer
        report={report}
        generatedAt={shared.analysis.created_at}
        analysisId={shared.analysis.id}
      />
      <ShareFooter />
    </>
  );
}

function ShareHeader({
  tenantName,
  createdAt,
}: {
  tenantName: string;
  createdAt: string;
}) {
  return (
    <header className="border-b border-tac-border bg-tac-bg-card/60">
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-baseline justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-tac-muted">TAC · Final Mile Analysis</p>
          <h1 className="text-xl font-semibold mt-0.5">{tenantName}</h1>
        </div>
        <p className="text-xs text-tac-muted">
          Generated {new Date(createdAt).toLocaleDateString("en-AU", { dateStyle: "medium" })}
        </p>
      </div>
    </header>
  );
}

function ShareFooter() {
  return (
    <footer className="max-w-7xl mx-auto px-4 py-6 text-xs text-tac-muted text-center">
      Shared via TAC Client Intelligence Suite. This report is read-only and reflects the data
      available at the time of generation.
    </footer>
  );
}

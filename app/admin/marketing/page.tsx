import MarketingDashboard from "@/components/marketing/MarketingDashboard";
import theme from "@/components/marketing/theme.module.css";
export default function MarketingPage() {
  return (
    <div className={`${theme.theme} ${theme.canvas}`}>
      <MarketingDashboard />
    </div>
  );
}

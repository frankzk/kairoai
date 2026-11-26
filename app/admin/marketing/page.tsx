import MarketingPage from "@/components/marketing/MarketingPage";
import theme from "@/components/marketing/theme.module.css";
export default function Marketing() {
  return (
    <div className={`${theme.theme} ${theme.canvas}`}>
      <MarketingPage />
    </div>
  );
}

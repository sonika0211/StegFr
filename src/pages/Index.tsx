import AuthPage from "@/components/stegfr/AuthPage";
import StegFrApp from "@/components/stegfr/StegFrApp";
import { useAuth } from "@/hooks/useAuth";

const Index = () => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-xs uppercase tracking-widest text-muted-foreground">
        Loading…
      </div>
    );
  }
  return user ? <StegFrApp /> : <AuthPage />;
};

export default Index;

import { useState } from "react";
import SignInPage from "@/components/stegfr/SignInPage";
import StegFrApp from "@/components/stegfr/StegFrApp";

const Index = () => {
  const [entered, setEntered] = useState(false);
  return entered ? <StegFrApp /> : <SignInPage onEnter={() => setEntered(true)} />;
};

export default Index;

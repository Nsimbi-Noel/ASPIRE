import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import LoginPage from "@/pages/Login";
import AccountPage from "@/pages/Account";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Dashboard from "./pages/Dashboard";
import { ApplicationsPage, NewApplicationPage, ApplicationDetailPage } from "./pages/Applications";
import ProgrammesPage from "./pages/Programmes";
import { DocumentsPage, GovernancePage } from "./pages/Operations";

function Router() {
  return <Switch>
    <Route path="/" component={Dashboard} />
    <Route path="/applications" component={ApplicationsPage} />
    <Route path="/applications/new" component={NewApplicationPage} />
    <Route path="/applications/:id" component={ApplicationDetailPage} />
    <Route path="/programmes" component={ProgrammesPage} />
    <Route path="/documents" component={DocumentsPage} />
    <Route path="/governance" component={GovernancePage} />
    <Route path="/login" component={LoginPage} />
    <Route path="/account" component={AccountPage} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
}

function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}

export default App;

import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { apiClient } from "../lib/api";
import { setAccessToken } from "../lib/auth";
import { SetupMode } from "../lib/types";
import { toast } from "sonner";

// We use this small number for the password rule.
// A number with a name is easier to understand than a hidden number.
// The app already required 8 letters before this refactor.
// We keep the same number, so the app acts exactly the same.
// We do not make the password rule smarter here.
// We do not make the password rule faster here.
// We only put the number in one easy place.
// If a beginner reads this, they can see the rule immediately.
// If the rule changes later, there is one simple place to look.
// Result: the password must still have at least 8 characters.
const MINIMUM_PASSWORD_LENGTH = 8;

// This type describes only the piece of the setup answer we need here.
// The server sends more data, but this page only needs the access token.
// The access token is like a small secret ticket.
// The app uses that ticket to prove the new admin is allowed in.
// We write the shape down so TypeScript can help us.
// TypeScript can then warn us if we spell a field name wrong.
// This does not change what the server sends.
// This does not add a new feature.
// It only makes the code easier to read and safer to edit.
// Result: helpers below can clearly say what kind of answer they expect.
type SetupInitResponse = {
  session: {
    access_token: string;
  };
};

// This type describes the tiny part of an error we read.
// Sometimes the API error has a response object.
// Sometimes it has response.data.
// Sometimes data has an error message.
// We do not know for sure, because network errors can look different.
// So every nested piece is marked as optional.
// Optional means: it might be there, or it might be missing.
// This keeps the old behavior from the original code.
// The old code also tried to read error.response.data.error.
// Result: we can safely explain the shape without using "any".
type SetupErrorWithOptionalMessage = {
  response?: {
    data?: {
      error?: string;
    };
  };
};

// This helper checks if one text box is empty.
// It receives one string, like the email or password.
// The name says exactly what question we are asking.
// We do not trim spaces here, because the old code did not trim spaces.
// Keeping that detail means the behavior stays the same.
// An empty string means the user typed nothing at all.
// The exclamation mark turns "has text" into "does not have text".
// We keep this helper tiny so a beginner can read it in one breath.
// Result: true means "this field is missing".
const isTextFieldEmpty = (text_value: string) => {
  // We check whether the text value is empty.
  // JavaScript treats an empty string as a "no" value.
  // The ! sign flips that "no" into true.
  // We return the answer so another helper can use it.
  // This is simple on purpose.
  // It avoids a clever shortcut inside a bigger function.
  // It also gives the check a plain English name.
  // Result: true for '', false for text like 'Ada'.
  return !text_value;
};

// This helper checks the three boxes on the admin form.
// The admin form needs a name, an email, and a password.
// If one of them is empty, setup cannot continue.
// We keep the checks on separate lines.
// Separate lines are easier for new readers than one long line.
// The helper returns only yes or no.
// It does not show a toast.
// It does not talk to the server.
// It only answers one small question.
// Result: true means all three required fields have some text.
const areAdminFieldsFilledIn = (
  email: string,
  password: string,
  display_name: string,
) => {
  // We ask if the email box is empty.
  // We store the answer because we need it below.
  // The variable name says what the answer means.
  // This is easier than reading !email inside a big if.
  // We do not change the email value.
  // We only look at it.
  // Result: true means the email box is blank.
  const email_is_empty = isTextFieldEmpty(email);

  // We ask if the password box is empty.
  // We store the answer so the next line is simple.
  // Password is required before setup can call the API.
  // This matches the old form behavior exactly.
  // We do not check password length here.
  // That is a different small job for another helper.
  // Result: true means the password box is blank.
  const password_is_empty = isTextFieldEmpty(password);

  // We ask if the display name box is empty.
  // Display name is what the admin wants to be called.
  // The old code required it, so we still require it.
  // We save the answer to make the final return easy.
  // We do not clean or change the name.
  // We only check if it exists.
  // Result: true means the display name box is blank.
  const display_name_is_empty = isTextFieldEmpty(display_name);

  // We combine the three small answers.
  // The && symbol means "and".
  // All three boxes must NOT be empty.
  // If even one box is empty, this becomes false.
  // This keeps the old rule: all fields are required.
  // We return the final yes or no to the submit handler.
  // Result: true means setup may continue to the password length check.
  return !email_is_empty && !password_is_empty && !display_name_is_empty;
};

// This helper checks whether the password is long enough.
// It does not decide if the password is strong.
// It does not add symbols or numbers.
// It only checks the same old length rule.
// The helper name explains the question in friendly words.
// The submit handler can read like a story because this check has a name.
// A beginner can understand this helper without knowing the whole app.
// Result: true means the password has at least 8 characters.
const isPasswordLongEnough = (password: string) => {
  // We count how many characters are in the password.
  // The length property gives us that count.
  // We compare the count to the named minimum number.
  // Greater than or equal means 8 is okay, and 9 is okay too.
  // Less than 8 is not okay.
  // We keep the exact old rule.
  // Result: true means the password passes the length rule.
  return password.length >= MINIMUM_PASSWORD_LENGTH;
};

// This helper shows the missing-fields message.
// It has only one job: tell the user what went wrong.
// We keep the same message text as before.
// Keeping the same text avoids changing the user experience.
// The helper exists so the submit handler stays small.
// Small pieces are easier to read when learning.
// It also makes the "why did we stop?" step very clear.
// Result: the user sees an error toast.
const showMissingFieldsMessage = () => {
  // We ask the toast library to show an error.
  // The message tells the user to fill every field.
  // This is the same message the old code used.
  // We do not return anything, because showing the toast is the whole job.
  // The submit handler will stop after calling this helper.
  // Result: a red error message appears on the page.
  toast.error("Please fill in all fields");
};

// This helper shows the short-password message.
// It has one clear job, just like the missing-fields helper.
// The old code used this same message.
// We keep it, so no feature or wording changes.
// This helper is separate because the password rule is separate.
// Separate helpers make it easier to teach each step.
// Result: the user learns the password needs 8 characters.
const showShortPasswordMessage = () => {
  // We ask the toast library to show an error.
  // The message explains the minimum password size.
  // The text stays the same as before the refactor.
  // We do not continue setup after this message.
  // Result: the user sees what to fix before trying again.
  toast.error("Password must be at least 8 characters");
};

// This helper saves the token in the two places the old code used.
// First, it saves the token in browser storage through setAccessToken.
// Second, it puts the token into the API client.
// The browser storage keeps the ticket for later page loads.
// The API client uses the ticket for requests right now.
// Doing both keeps the user signed in after setup.
// This is the same behavior as the original code.
// We only gave the steps names and comments.
// Result: future API calls can prove the admin is logged in.
const saveSetupAccessToken = (setup_response: SetupInitResponse) => {
  // We take the access token out of the setup response.
  // The token is nested inside session.
  // We save it in a named variable because we use it twice.
  // A named variable is easier to read than repeating the long path.
  // We do not change the token value.
  // We only copy the reference into a friendly name.
  // Result: setup_access_token contains the admin's login ticket.
  const setup_access_token = setup_response.session.access_token;

  // We save the token in local storage using the existing helper.
  // This keeps the token available after a refresh.
  // The helper already knows the exact storage key.
  // We do not duplicate that storage key here.
  // This keeps the old app behavior exactly the same.
  // Result: the browser remembers the admin's ticket.
  setAccessToken(setup_access_token);

  // We give the same token to the API client.
  // The API client attaches the token to later requests.
  // This lets the dashboard call protected API endpoints right away.
  // Without this step, the user might look logged in but requests would fail.
  // This is exactly what the original code already did.
  // Result: API requests after setup include the admin's ticket.
  apiClient.setToken(setup_access_token);
};

// This helper extracts a friendly error message from an unknown error.
// Network and server errors can have different shapes.
// The old code looked for error.response.data.error first.
// If that was missing, it used a backup message.
// We keep the same rule here.
// The helper keeps optional error reading out of the main submit story.
// This makes the submit handler easier for beginners.
// Result: we always get one string that is safe to show in a toast.
const getSetupErrorMessage = (error: unknown) => {
  // We gently tell TypeScript the error might have the response shape above.
  // This does not change the real error.
  // It only lets us read optional fields in a typed way.
  // The fields may still be missing, so we use optional chaining below.
  // Result: maybe_error can be inspected safely.
  const maybe_error = error as SetupErrorWithOptionalMessage;

  // We try to read the server's own error text.
  // The ?. marks mean "only keep going if this piece exists".
  // This prevents crashes when a network error has no response.
  // The old code used the same path and the same backup message.
  // Result: a server message is used when it exists; otherwise the backup is used.
  return maybe_error.response?.data?.error || "Failed to complete setup";
};

// This helper does everything that should happen after the server succeeds.
// The server has created the first admin account.
// The server has also returned a session token.
// We save that token, show the happy message, and open the dashboard.
// These are exactly the same actions the old code performed.
// They are grouped here because they all belong to the success path.
// A beginner can read this helper as "what happens when setup worked".
// Result: the user is welcomed and sent to the dashboard.
const finishSuccessfulSetup = (
  setup_response: SetupInitResponse,
  navigate_to_page: ReturnType<typeof useNavigate>,
) => {
  // We save the access token for browser storage and API calls.
  // This makes the newly created admin act logged in right away.
  // We use a helper so the saving steps are explained in one place.
  // Result: the app now has the admin's login ticket.
  saveSetupAccessToken(setup_response);

  // We show the same success message as before.
  // This tells the user that setup finished correctly.
  // We keep the old words so the UI behavior does not change.
  // Result: a happy toast appears on the screen.
  toast.success("Setup complete! Welcome to Docker Panel");

  // We move the user to the dashboard page.
  // The dashboard is where the user goes after setup.
  // This is the same destination as the old code.
  // Result: the browser changes to /dashboard.
  navigate_to_page("/dashboard");
};

const SimpleLogo = ({ size = 64 }: { size?: number }) => (
  <div
    className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-3xl"
    style={{ width: size, height: size }}
  >
    IP
  </div>
);

export const Setup = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<"mode" | "admin">("mode");
  const [mode, setMode] = useState<SetupMode>("personal");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleModeSelect = (selectedMode: SetupMode) => {
    setMode(selectedMode);
    setStep("admin");
  };

  // This function runs when the admin form is submitted.
  // "Submitted" means the user pressed the Complete Setup button.
  // The old code did all work in one medium-sized block.
  // We now make the steps read like a simple story.
  // Step 1: stop the browser's normal form reload.
  // Step 2: check that all boxes have text.
  // Step 3: check that the password is long enough.
  // Step 4: turn on the loading state.
  // Step 5: ask the API to create the first admin.
  // Step 6: save the returned access token and go to the dashboard.
  // Step 7: if something breaks, show the same error message as before.
  // Step 8: always turn loading off when the work ends.
  // The result is the same as before, just easier to read and teach.
  const handleCreateAdmin = async (form_submit_event: FormEvent) => {
    // We stop the browser from doing its default form action.
    // The default action would reload the page.
    // A reload would interrupt our React code.
    // We want React to stay in control of the setup flow.
    // This line was also in the old code.
    // Result: the page stays open while we run our own setup steps.
    form_submit_event.preventDefault();

    // We check whether the three required boxes are filled in.
    // The helper checks email, password, and display name.
    // We store the answer with a clear name.
    // This makes the next if statement very easy to read.
    // Result: true means the form has the required text.
    const admin_fields_are_filled_in = areAdminFieldsFilledIn(
      email,
      password,
      displayName,
    );

    // We stop early if a required field is missing.
    // Stopping early avoids calling the server with bad form data.
    // This is the same behavior the old code had.
    // The helper shows the same toast message as before.
    // Result: the user sees what to fix, and setup does not continue.
    if (!admin_fields_are_filled_in) {
      // We show the missing-fields message.
      // This tells the user to fill every box.
      // The message text is unchanged from the original code.
      // Result: an error toast appears.
      showMissingFieldsMessage();

      // We leave the function now.
      // Leaving now is important because the form is not ready.
      // This prevents the API request from happening too soon.
      // Result: no admin account request is sent yet.
      return;
    }

    // We check the password length after the empty-field check.
    // This order matches the old code.
    // The helper uses the same minimum length as before.
    // We save the answer so the if statement reads like English.
    // Result: true means the password is long enough for setup.
    const password_is_long_enough = isPasswordLongEnough(password);

    // We stop early if the password is too short.
    // A short password should not be sent to the setup API.
    // This keeps the same old validation behavior.
    // The helper shows the same message as before.
    // Result: the user sees the password rule and can try again.
    if (!password_is_long_enough) {
      // We show the short-password message.
      // This tells the user the password needs at least 8 characters.
      // The message text is unchanged from the original code.
      // Result: an error toast appears.
      showShortPasswordMessage();

      // We leave the function now.
      // The password is not ready for setup yet.
      // This prevents the server request from running.
      // Result: setup waits until the user fixes the password.
      return;
    }

    // We turn on loading before the slow API request starts.
    // Loading disables the form controls in the JSX below.
    // This helps stop double-clicks and duplicate setup attempts.
    // The old code also turned loading on at this moment.
    // Result: the UI shows that work is happening.
    setLoading(true);

    // We use try/catch/finally for the server call.
    // The try part is the happy path.
    // The catch part handles errors.
    // The finally part runs no matter what happened.
    // This structure already existed in the old code.
    // Result: success and failure are both handled safely.
    try {
      // We ask the API to initialize setup.
      // We send the same four values as the old code.
      // Email identifies the admin account.
      // Password protects the admin account.
      // Display name is the friendly name for the admin.
      // Mode says whether setup is personal or business.
      // Result: the server creates setup and returns a session token.
      const setup_response = await apiClient.initSetup(
        email,
        password,
        displayName,
        mode,
      );

      // We run the success steps in one clearly named helper.
      // The helper saves the token, shows the success toast, and navigates.
      // These are the same actions the old code performed.
      // Result: the new admin is treated as logged in and sees the dashboard.
      finishSuccessfulSetup(setup_response, navigate);
    } catch (error: unknown) {
      // We log the error for developers.
      // This keeps the same console message as the old code.
      // The user does not need to read this console message.
      // Developers can use it when debugging setup problems.
      // Result: details are visible in the browser console.
      console.error("Setup error:", error);

      // We choose the best error message to show the user.
      // The helper first tries the server message.
      // If no server message exists, it uses the old fallback text.
      // Result: setup errors still show a useful toast.
      const setup_error_message = getSetupErrorMessage(error);

      // We show the error message in a toast.
      // This matches the old user-facing behavior.
      // The user gets feedback instead of silence.
      // Result: the user can see that setup failed.
      toast.error(setup_error_message);
    } finally {
      // We turn loading off after success or failure.
      // The finally block always runs.
      // This is important because the form should not stay disabled forever.
      // The old code also did this exact cleanup.
      // Result: the form controls become usable again if the page is still here.
      setLoading(false);
    }
  };

  if (step === "mode") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="flex justify-center mb-6">
              <SimpleLogo size={64} />
            </div>
            <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
              Welcome to Docker Panel
            </h1>
            <p className="text-lg text-slate-600 dark:text-slate-300">
              Let's set up your self-hosted Docker management platform
            </p>
          </div>

          {/* Mode Selection */}
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-6">
              Choose Your Setup Mode
            </h2>

            <button
              onClick={() => handleModeSelect("personal")}
              className="w-full p-6 border-2 border-slate-200 dark:border-slate-700 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all text-left"
            >
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                🏠 Personal Mode
              </h3>
              <p className="text-slate-600 dark:text-slate-300 mb-3">
                Self-hosted Docker panel for your apps
              </p>
              <ul className="text-sm text-slate-500 dark:text-slate-400 space-y-1">
                <li>✓ Simple Docker app management</li>
                <li>✓ Start, stop, restart containers</li>
                <li>✓ View logs and configure environments</li>
                <li>✓ Perfect for hobby projects and self-hosting</li>
              </ul>
            </button>

            <button
              onClick={() => handleModeSelect("business")}
              className="w-full p-6 border-2 border-slate-200 dark:border-slate-700 rounded-lg hover:border-purple-500 dark:hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all text-left"
            >
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                🚀 Hosting Business Mode
              </h3>
              <p className="text-slate-600 dark:text-slate-300 mb-3">
                Full-featured hosting control panel
              </p>
              <ul className="text-sm text-slate-500 dark:text-slate-400 space-y-1">
                <li>✓ All Personal Mode features</li>
                <li>✓ Customer account management</li>
                <li>✓ Plans, pricing, and billing</li>
                <li>✓ White-label and team management</li>
              </ul>
            </button>
          </div>

          {/* Info */}
          <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-900 dark:text-blue-100">
              <strong>Note:</strong> You can change modes later. Personal Mode
              is recommended for most self-hosters.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <SimpleLogo size={48} />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
            Create Admin Account
          </h1>
          <p className="text-slate-600 dark:text-slate-300 mt-2">
            {mode === "personal"
              ? "Setting up Personal Mode"
              : "Setting up Hosting Business Mode"}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleCreateAdmin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-6 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold rounded-lg transition-colors"
          >
            {loading ? "Setting up..." : "Complete Setup"}
          </button>

          <button
            type="button"
            onClick={() => setStep("mode")}
            disabled={loading}
            className="w-full px-4 py-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
          >
            Back to Mode Selection
          </button>
        </form>
      </div>
    </div>
  );
};

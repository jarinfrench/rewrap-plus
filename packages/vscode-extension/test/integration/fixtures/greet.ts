/**
 * Greets somebody by name, returning a friendly message suitable for display in the UI somewhere.
 *
 * @param name The name of the person to greet, used verbatim in the resulting message text.
 * @returns A greeting message that includes the given name.
 */
function greet(name: string): string {
  // build the message using string concatenation so the wrapper has something real to reflow here
  return "Hello, " + name + "! Welcome to the application, we hope you enjoy your stay here today.";
}

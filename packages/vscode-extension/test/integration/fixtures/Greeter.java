class Greeter {
  /**
   * Greets somebody by name, returning a friendly message suitable for display in the UI somewhere.
   *
   * @param name The name of the person to greet, used verbatim in the resulting message text.
   * @return A greeting message that includes the given name.
   */
  String greet(String name) {
    // build the message using operator concatenation so the wrapper has something real to reflow here
    return "Hello, " + "there! Welcome to the application, we hope you enjoy your stay here today.";
  }
}

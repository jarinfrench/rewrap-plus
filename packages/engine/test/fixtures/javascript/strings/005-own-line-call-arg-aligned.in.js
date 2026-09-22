function check(atoms) {
  if (atoms.length !== 1) {
    throw new Error(
      "InterfaceCandidate atoms must be a one-dimensional " +
        "structured array containing name, x, y, and z fields"
    );
  }
}

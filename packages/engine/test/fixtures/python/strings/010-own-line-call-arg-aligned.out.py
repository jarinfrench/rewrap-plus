def check(atoms):
    if atoms.ndim != 1:
        raise ValueError(
            "InterfaceCandidate atoms must be a "
            "one-dimensional structured array containing "
            "name, x, y, and z fields"
        )

def deploy(really_long_deployment_target_identifier, dry_run=False):
    """Deploy to the given target, with café-safe
    unicode handling ✨.

    Args:
        really_long_deployment_target_identifier: A
                                                  verbose
                                                  identifier
                                                  naming
                                                  the
                                                  deployment
                                                  target.
        dry_run: Options include:

                 - verbose: Whether to print each
                   step as it executes.
                 - strict: Whether to abort on the
                   first warning encountered.

                 Example usage:

                 ```
                 deploy("prod-eu-west", dry_run=True)
                 ```

    Returns:
        None: Nothing is returned.
    """
    return _do_deploy(really_long_deployment_target_identifier, dry_run)

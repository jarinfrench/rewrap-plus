/// Releases the value referenced by `handle` if `deleter` is true then
/// calls `deleter` on it.
/// - `handle` : The handle identifying the value to remove.
/// - `deleter` : Callable with signature `deleter(T*)`.
void release(Handle handle, Deleter deleter);

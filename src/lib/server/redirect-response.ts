export function redirectResponse(location: URL | string, status = 303) {
  return new Response(null, {
    headers: {
      Location: location.toString(),
    },
    status,
  });
}

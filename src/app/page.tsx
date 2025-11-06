// This file redirects the root route to the brand dashboard page.
import { redirect } from 'next/navigation';

export default function Home(): never {
  redirect('/brand');
}

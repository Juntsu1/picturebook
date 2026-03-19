import { Timestamp } from 'firebase-admin/firestore';
import { getDb } from '../lib/firebase.js';

export interface ChildProfileDoc {
  name: string;
  age: number;
  gender: string | null;
  favoriteColor: string | null;
  favoriteAnimal: string | null;
  appearance: string | null;
  photoUrl: string | null;
  photoStoragePath: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProfileResponse {
  id: string;
  name: string;
  age: number;
  gender?: string;
  favoriteColor?: string;
  favoriteAnimal?: string;
  appearance?: string;
  photoUrl?: string;
  createdAt: string;
}

function toProfileResponse(id: string, doc: ChildProfileDoc): ProfileResponse {
  const response: ProfileResponse = {
    id,
    name: doc.name,
    age: doc.age,
    createdAt: doc.createdAt.toDate().toISOString(),
  };
  if (doc.gender) response.gender = doc.gender;
  if (doc.favoriteColor) response.favoriteColor = doc.favoriteColor;
  if (doc.favoriteAnimal) response.favoriteAnimal = doc.favoriteAnimal;
  if (doc.appearance) response.appearance = doc.appearance;
  if (doc.photoUrl) response.photoUrl = doc.photoUrl;
  return response;
}

function getProfilesCollection(userId: string) {
  return getDb().collection('users').doc(userId).collection('childProfiles');
}

export async function createProfile(
  userId: string,
  data: {
    name: string;
    age: number;
    gender?: string;
    favoriteColor?: string;
    favoriteAnimal?: string;
    appearance?: string;
    photoUrl?: string;
    photoStoragePath?: string;
  }
): Promise<ProfileResponse> {
  const now = Timestamp.now();
  const doc: ChildProfileDoc = {
    name: data.name,
    age: data.age,
    gender: data.gender ?? null,
    favoriteColor: data.favoriteColor ?? null,
    favoriteAnimal: data.favoriteAnimal ?? null,
    appearance: data.appearance ?? null,
    photoUrl: data.photoUrl ?? null,
    photoStoragePath: data.photoStoragePath ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const ref = await getProfilesCollection(userId).add(doc);
  return toProfileResponse(ref.id, doc);
}

export async function getProfiles(userId: string): Promise<ProfileResponse[]> {
  const snapshot = await getProfilesCollection(userId)
    .orderBy('createdAt', 'desc')
    .get();

  return snapshot.docs.map((d) =>
    toProfileResponse(d.id, d.data() as ChildProfileDoc)
  );
}

export async function getProfileById(
  userId: string,
  profileId: string
): Promise<ProfileResponse | null> {
  const doc = await getProfilesCollection(userId).doc(profileId).get();
  if (!doc.exists) return null;
  return toProfileResponse(doc.id, doc.data() as ChildProfileDoc);
}

export async function getProfileRawById(
  userId: string,
  profileId: string
): Promise<(ChildProfileDoc & { id: string }) | null> {
  const doc = await getProfilesCollection(userId).doc(profileId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as ChildProfileDoc) };
}

export async function updateProfilePhoto(
  userId: string,
  profileId: string,
  photoUrl: string,
  photoStoragePath: string
): Promise<void> {
  await getProfilesCollection(userId).doc(profileId).update({
    photoUrl,
    photoStoragePath,
    updatedAt: Timestamp.now(),
  });
}

export async function clearProfilePhoto(
  userId: string,
  profileId: string
): Promise<void> {
  await getProfilesCollection(userId).doc(profileId).update({
    photoUrl: null,
    photoStoragePath: null,
    updatedAt: Timestamp.now(),
  });
}

export async function deleteProfile(
  userId: string,
  profileId: string
): Promise<void> {
  await getProfilesCollection(userId).doc(profileId).delete();
}

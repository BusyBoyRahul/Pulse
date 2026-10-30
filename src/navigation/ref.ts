import {createNavigationContainerRef} from '@react-navigation/native';
import type {RootStackParamList} from './types';

/**
 * Lets code OUTSIDE a screen (the Dynamic Island, call handling) move the user
 * around — e.g. tapping a message pop-up opens that chat.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
